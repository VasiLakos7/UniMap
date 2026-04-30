import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

import { RouteService } from './route.service';
import { bearingDeg, angleDiffDeg, smoothAngle, applyMaxStep } from './map-geo.utils';

@Injectable({ providedIn: 'root' })
export class GpsService {
  // ── Public events ──────────────────────────────────────────────────────────
  public locationFound = new EventEmitter<{ lat: number; lng: number; accuracy?: number }>();
  public locationError = new EventEmitter<void>();
  public gpsStale     = new EventEmitter<boolean>();

  // ── Public state (read by map/route services) ──────────────────────────────
  public lastSpeedMps  = 0;
  public lastAccM      = 9999;
  public lastHeadingDeg: number | null = null;

  // ── Watch IDs ──────────────────────────────────────────────────────────────
  private watchId:    string | null = null;
  private webWatchId: number | null = null;
  private hasInitialFix = false;

  // ── Fast polling (replaces watchPosition on native — bypasses Android 5s throttle) ──
  private pollActive = false;
  private readonly POLL_INTERVAL_MS = 800;

  // ── Jump detection — tracks last ACCEPTED fix only ─────────────────────────
  private prevAcceptedLL: L.LatLng | null = null;
  private prevAcceptedAt = 0;
  private readonly JUMP_MAX_DIST_M    = 40;
  private readonly JUMP_MAX_WALK_MPS  = 7.0;   // above this → teleport (reject)

  // ── EMA smoothing state (used only when stationary) ───────────────────────
  private smoothLL: L.LatLng | null = null;

  // ── Marker update state ────────────────────────────────────────────────────


  // ── Speed thresholds ───────────────────────────────────────────────────────
  private readonly SPEED_MOVING_MPS          = 0.3;   // below = stationary (EMA active)
  private readonly SPEED_USE_GPS_HEADING_MPS = 0.8;
  private readonly SPEED_TRUST_BEARING_MPS   = 0.5;
  private readonly MIN_MOVE_FOR_BEARING_M    = 0.8;
  private readonly MAX_HEADING_JUMP_DEG      = 65;

  // ── Accuracy caps ──────────────────────────────────────────────────────────
  private readonly ACC_MAX_NATIVE_M = 40;
  private readonly ACC_MAX_WEB_M    = 800;
  private readonly ACC_TRUST_BEARING_M = 40;

  // ── Heading from movement ──────────────────────────────────────────────────
  private prevHeadingLL: L.LatLng | null = null;

  // ── Compass ────────────────────────────────────────────────────────────────
  private compassEnabled = false;
  private lastCompassAt  = 0;
  private compassHeadingDeg: number | null = null;
  private compassHeadingAt = 0;
  private onDeviceOrientationAbs?: (e: DeviceOrientationEvent) => void;
  private onDeviceOrientation?:    (e: DeviceOrientationEvent) => void;
  private readonly COMPASS_MIN_INTERVAL_MS  = 80;
  private readonly COMPASS_DEADBAND_DEG     = 4.0;
  private readonly COMPASS_SMOOTH_ALPHA_ABS = 0.38;
  private readonly COMPASS_SMOOTH_ALPHA_REL = 0.30;
  private readonly COMPASS_MAX_TURN_DPS     = 360;
  private readonly COMPASS_REJECT_SPIKE_DEG = 150;
  private readonly NAV_COMPASS_INTERVAL_MS  = 100;
  private lastNavCompassApplyAt = 0;

  // ── UI emit throttle ───────────────────────────────────────────────────────
  private lastEmitAt  = 0;
  private lastEmitLL: L.LatLng | null = null;
  private readonly EMIT_MIN_INTERVAL_MS = 180;
  private readonly EMIT_MIN_MOVE_M      = 0.8;

  // ── GPS staleness watchdog ─────────────────────────────────────────────────
  private staleTimer: any = null;
  private staleActive = false;
  private readonly GPS_STALE_MS = 15000;

  // ── Callbacks registered by MapService ────────────────────────────────────
  private updatePositionCb?: (lat: number, lng: number) => void;
  private applyHeadingCb?:   (deg: number) => void;
  private mapCenterCb?:      (lat: number, lng: number, zoom: number) => void;
  private isNavModeCb?:      () => boolean;

  constructor(private routeSvc: RouteService) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  public isWatching(): boolean {
    return this.watchId !== null || this.webWatchId !== null;
  }

  public registerCallbacks(
    updatePosition: (lat: number, lng: number) => void,
    applyHeading:   (deg: number) => void,
    mapCenter:      (lat: number, lng: number, zoom: number) => void,
    isNavMode:      () => boolean
  ): void {
    this.updatePositionCb = updatePosition;
    this.applyHeadingCb   = applyHeading;
    this.mapCenterCb      = mapCenter;
    this.isNavModeCb      = isNavMode;
  }

  /** Apply a heading externally (e.g. simulator). */
  public setUserHeading(deg: number): void {
    this.applyHeadingInternal(deg);
  }

  /**
   * Re-run the last accepted GPS fix through the current pipeline state.
   * Called at navigation start so map-matching snaps the marker to the route
   * immediately — without waiting for the next poll cycle (up to 2+ seconds).
   * Also clears the EMA so accumulated stationary smoothing doesn't lag.
   */
  public reprocessLastFix(): void {
    if (!this.hasInitialFix || !this.prevAcceptedLL) return;
    this.smoothLL   = null;   // discard EMA from stationary period
    this.lastEmitAt = 0;      // allow locationFound to fire immediately
    this.handleFix(
      this.prevAcceptedLL.lat,
      this.prevAcceptedLL.lng,
      this.lastAccM,
      null,
      this.lastSpeedMps,
      false,
      0
    );
  }

  // ── Permissions ────────────────────────────────────────────────────────────

  public async requestLocationPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return true;
    const p = await Geolocation.checkPermissions();
    if (p.location === 'granted' || (p as any).coarseLocation === 'granted') return true;
    const req = await Geolocation.requestPermissions({ permissions: ['location'] as any });
    return req.location === 'granted' || (req as any).coarseLocation === 'granted';
  }

  private async ensureLocationPermission(): Promise<boolean> {
    return this.requestLocationPermission();
  }

  public async getInitialPosition(timeoutMs = 15000): Promise<{ lat: number; lng: number } | null> {
    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) return null;
      return new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 }
        )
      );
    }
    if (!(await this.ensureLocationPermission())) return null;
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: Math.min(timeoutMs, 10000),
        maximumAge: 10000,
      });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  }

  // ── GPS Watch ───────────────────────────────────────────────────────────────

  public async startGpsWatch(centerOnFirstFix = true, zoomOnFirstFix = 18): Promise<void> {
    await this.stopGpsWatch();
    this.resetState();
    this.routeSvc.resetSnapState();
    this.startCompass();

    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) { this.locationError.emit(); return; }
      const opts: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
      const cb = (pos: GeolocationPosition) =>
        this.handleFix(
          pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy,
          (pos.coords as any).heading ?? null, (pos.coords as any).speed ?? null,
          centerOnFirstFix, zoomOnFirstFix
        );
      navigator.geolocation.getCurrentPosition(cb, () => this.locationError.emit(), opts);
      this.webWatchId = navigator.geolocation.watchPosition(cb, () => this.locationError.emit(), opts);
      return;
    }

    if (!(await this.ensureLocationPermission())) { this.locationError.emit(); return; }

    // Eager first fix — gets marker on screen faster than waiting for watchPosition.
    // maximumAge: 10000 reuses the cached fix from getInitialPosition so the dot
    // appears instantly; the poll loop refreshes with a live fix within ~800ms.
    try {
      const first = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 10000, maximumAge: 10000,
      });
      this.handleFix(
        first.coords.latitude, first.coords.longitude, first.coords.accuracy,
        first.coords.heading ?? null, first.coords.speed ?? null,
        centerOnFirstFix, zoomOnFirstFix
      );
    } catch {}

    // Fast polling loop — getCurrentPosition at ~800ms bypasses Android's
    // watchPosition throttle (which fires only every 5s on many devices).
    this.pollActive = true;
    this.runPollLoop(centerOnFirstFix, zoomOnFirstFix);
  }

  public async stopGpsWatch(): Promise<void> {
    if (this.webWatchId != null) {
      try { navigator.geolocation.clearWatch(this.webWatchId); } catch {}
      this.webWatchId = null;
    }
    this.pollActive = false;
    if (this.watchId) {
      try { await Geolocation.clearWatch({ id: this.watchId }); } catch {}
      this.watchId = null;
    }
    this.stopCompass();
    if (this.staleTimer)  { clearTimeout(this.staleTimer); this.staleTimer = null; }
    if (this.staleActive) { this.staleActive = false; this.gpsStale.emit(false); }
    this.routeSvc.resetSnapState();
    this.resetState();
  }

  private async runPollLoop(centerOnFirstFix: boolean, zoomOnFirstFix: number): Promise<void> {
    while (this.pollActive) {
      try {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true, timeout: 5000, maximumAge: 0,
        });
        if (!this.pollActive) break;
        this.handleFix(
          pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy,
          pos.coords.heading ?? null, pos.coords.speed ?? null,
          centerOnFirstFix, zoomOnFirstFix
        );
      } catch { /* ignore transient errors */ }
      if (!this.pollActive) break;
      await new Promise<void>(r => setTimeout(r, this.POLL_INTERVAL_MS));
    }
  }

  private resetState(): void {
    this.hasInitialFix    = false;
    this.prevAcceptedLL   = null;
    this.prevAcceptedAt   = 0;
    this.smoothLL         = null;
    this.prevHeadingLL    = null;
    this.lastHeadingDeg   = null;
    this.lastSpeedMps     = 0;
    this.lastAccM         = 9999;
    this.lastEmitAt       = 0;
    this.lastEmitLL       = null;
    this.compassHeadingDeg  = null;
    this.compassHeadingAt   = 0;
    this.lastNavCompassApplyAt = 0;
  }

  // ── Core fix handler ────────────────────────────────────────────────────────

  private handleFix(
    lat: number, lng: number,
    accuracy?: number | null, heading?: number | null, speed?: number | null,
    centerOnFirstFix = true, zoomOnFirstFix = 18
  ): void {
    const nowMs = Date.now();
    const acc = accuracy ?? 9999;
    const spd = speed ?? 0;

    this.lastSpeedMps = spd;
    this.lastAccM     = acc;

    const rawNow = L.latLng(lat, lng);

    // ── 1. Jump filter ──────────────────────────────────────────────────────
    if (this.hasInitialFix && this.isLikelyJump(rawNow, nowMs, spd)) return;

    // ── 2. Accuracy cap ─────────────────────────────────────────────────────
    if (this.hasInitialFix && acc > (Capacitor.isNativePlatform() ? this.ACC_MAX_NATIVE_M : this.ACC_MAX_WEB_M)) return;

    // ── 3. Update accepted-fix history ──────────────────────────────────────
    const prevLL = this.prevAcceptedLL;           // save BEFORE overwriting
    this.prevAcceptedLL = rawNow;
    this.prevAcceptedAt = nowMs;

    // Set hasInitialFix on the very first accepted fix regardless of centerOnFirstFix.
    // (Ensures jump-filter and accuracy-cap are active even when centerOnFirstFix=false.)
    const wasFirstFix = !this.hasInitialFix;
    if (wasFirstFix) this.hasInitialFix = true;

    // ── 4. Route snap ───────────────────────────────────────────────────────
    const { chosen, resetSmooth } = this.routeSvc.computeSnappedPosition(
      rawNow, spd, acc,
      (deg) => this.applyHeadingInternal(deg),
      this.lastHeadingDeg, this.smoothLL
    );
    if (resetSmooth) this.smoothLL = chosen;

    // ── 5. Position smoothing ───────────────────────────────────────────────
    // Moving  → raw snapped position, zero EMA lag.
    // Stationary → EMA suppresses ±3-8m GPS jitter oscillation.
    //
    // Use GPS speed OR position delta to detect motion — many Android devices
    // report speed=0 or null even when walking, causing EMA to lag 3+ seconds.
    const posDeltaM = prevLL ? prevLL.distanceTo(rawNow) : 0;
    const isMoving  = spd >= this.SPEED_MOVING_MPS || posDeltaM >= 0.5;

    let position: L.LatLng;
    if (isMoving) {
      this.smoothLL = chosen;
      position = chosen;
    } else {
      position = this.smoothLatLng(chosen);
    }

    // ── 6. Send to marker ───────────────────────────────────────────────────
    // No distance filter — every GPS fix reaches the animation engine so that
    // dead-reckoning velocity stays accurate and the marker never parks mid-walk.
    this.updatePositionCb?.(position.lat, position.lng);

    this.resetStaleTimer();

    // ── 7. UI emit (throttled) ──────────────────────────────────────────────
    if (this.shouldEmitToUI(chosen, nowMs)) {
      this.locationFound.emit({ lat: chosen.lat, lng: chosen.lng, accuracy: acc });
    }

    // ── 8. Route ops ────────────────────────────────────────────────────────
    void this.routeSvc.maybeReroute(rawNow, acc, spd);
    this.routeSvc.checkArrival(rawNow, acc);

    // ── 9. Heading ──────────────────────────────────────────────────────────
    const hLL = this.routeSvc.isMapMatchEnabled() && this.routeSvc.isSnapEngaged()
      ? chosen : rawNow;
    const usedMovement = this.updateHeadingFromMovement(hLL);
    if (!usedMovement) {
      if (typeof heading === 'number' && isFinite(heading) && spd > this.SPEED_USE_GPS_HEADING_MPS) {
        this.applyHeadingInternal(smoothAngle(this.lastHeadingDeg, heading, 0.4));
      }
      // Compass fills in heading continuously via applyIfDot in startCompass().
    }

    // ── 10. First-fix centering ─────────────────────────────────────────────
    if (centerOnFirstFix && wasFirstFix) {
      try { this.mapCenterCb?.(lat, lng, zoomOnFirstFix); } catch {}
      try { this.locationFound.emit({ lat, lng, accuracy: acc }); } catch {}
    }
  }

  // ── EMA smoothing (stationary only) ────────────────────────────────────────

  private smoothLatLng(next: L.LatLng): L.LatLng {
    if (!this.smoothLL) { this.smoothLL = next; return next; }
    // Low alpha = strong smoothing = kills oscillation while standing still.
    const a = this.lastAccM > 35 ? 0.20 : 0.28;
    this.smoothLL = L.latLng(
      this.smoothLL.lat + (next.lat - this.smoothLL.lat) * a,
      this.smoothLL.lng + (next.lng - this.smoothLL.lng) * a
    );
    return this.smoothLL;
  }

  // ── Jump detection ──────────────────────────────────────────────────────────
  // Only compares against the last ACCEPTED fix so a series of bad fixes
  // does not "walk" the reference point into bad territory.

  private isLikelyJump(rawNow: L.LatLng, nowMs: number, speedMps: number): boolean {
    if (!this.prevAcceptedLL) return false;   // no history yet

    const dtS   = Math.max(0.01, (nowMs - this.prevAcceptedAt) / 1000);
    const distM = this.prevAcceptedLL.distanceTo(rawNow);

    if (dtS >= 6) return false;  // long gap — GPS regained after tunnel/building, accept
    if (distM <= this.JUMP_MAX_DIST_M) return false;  // normal move, accept

    // Large jump: reject unless GPS speed or implied speed justifies it
    if (speedMps >= 3.5) return false;                          // GPS says fast (vehicle), accept
    if (distM / dtS <= this.JUMP_MAX_WALK_MPS) return false;   // implied speed is plausible, accept
    return true;  // teleport — reject
  }

  // ── UI emit throttle ────────────────────────────────────────────────────────

  private shouldEmitToUI(ll: L.LatLng, nowMs: number): boolean {
    if (!this.lastEmitLL || !this.lastEmitAt) {
      this.lastEmitLL = ll; this.lastEmitAt = nowMs; return true;
    }
    const dt    = nowMs - this.lastEmitAt;
    const moved = this.lastEmitLL.distanceTo(ll);
    if (dt >= this.EMIT_MIN_INTERVAL_MS || moved >= this.EMIT_MIN_MOVE_M) {
      this.lastEmitAt = nowMs; this.lastEmitLL = ll; return true;
    }
    return false;
  }

  // ── Heading from movement ───────────────────────────────────────────────────

  private updateHeadingFromMovement(rawNow: L.LatLng): boolean {
    if (!this.prevHeadingLL) { this.prevHeadingLL = rawNow; return false; }
    if (this.lastAccM     > this.ACC_TRUST_BEARING_M)   return false;
    if (this.lastSpeedMps < this.SPEED_TRUST_BEARING_MPS) return false;

    const d = this.prevHeadingLL.distanceTo(rawNow);
    if (d < this.MIN_MOVE_FOR_BEARING_M) return false;

    const deg = bearingDeg(this.prevHeadingLL, rawNow);
    this.prevHeadingLL = rawNow;
    if (!isFinite(deg)) return false;

    if (this.lastHeadingDeg != null) {
      const diff = angleDiffDeg(this.lastHeadingDeg, deg);
      if (Math.abs(diff) > this.MAX_HEADING_JUMP_DEG && this.lastSpeedMps < 1.2) return false;
    }

    const alpha = this.routeSvc.isMapMatchEnabled() && this.routeSvc.isSnapEngaged() ? 0.65 : 0.4;
    this.applyHeadingInternal(smoothAngle(this.lastHeadingDeg, deg, alpha));
    return true;
  }

  // ── Staleness watchdog ──────────────────────────────────────────────────────

  private resetStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.staleActive) { this.staleActive = false; this.gpsStale.emit(false); }
    this.staleTimer = setTimeout(() => {
      this.staleActive = true; this.gpsStale.emit(true);
    }, this.GPS_STALE_MS);
  }

  // ── Heading helper ──────────────────────────────────────────────────────────

  private applyHeadingInternal(deg: number): void {
    this.lastHeadingDeg = deg;
    this.applyHeadingCb?.(deg);
  }

  // ── Compass ─────────────────────────────────────────────────────────────────

  private startCompass(): void {
    if (this.compassEnabled) return;
    this.compassEnabled = true;

    const req = (DeviceOrientationEvent as any)?.requestPermission;
    if (typeof req === 'function') { try { req().catch(() => {}); } catch {} }

    const computeHeading = (ev: DeviceOrientationEvent): number | null => {
      const alpha = (ev as any).alpha;
      if (typeof alpha !== 'number' || !isFinite(alpha)) return null;

      let heading = (360 - alpha) % 360;

      // Adjust for screen rotation
      const angle = (
        screen.orientation && typeof (screen.orientation as any).angle === 'number'
          ? (screen.orientation as any).angle
          : typeof (window as any).orientation === 'number'
            ? (window as any).orientation
            : 0
      ) ?? 0;
      heading = (heading + angle + 360) % 360;

      const prev = this.compassHeadingDeg ?? this.lastHeadingDeg ?? null;
      if (prev != null) {
        const diff = angleDiffDeg(prev, heading);
        if (Math.abs(diff) < this.COMPASS_DEADBAND_DEG) return null;
        if ((this.lastSpeedMps ?? 0) < 0.8 && Math.abs(diff) >= this.COMPASS_REJECT_SPIKE_DEG) return null;
        const dtS = Math.max(0.016,
          (Date.now() - (this.compassHeadingAt || Date.now())) / 1000);
        heading = applyMaxStep(prev, heading, this.COMPASS_MAX_TURN_DPS * dtS);
      }

      const isAbs = (ev as any).absolute === true;
      const a = isAbs ? this.COMPASS_SMOOTH_ALPHA_ABS : this.COMPASS_SMOOTH_ALPHA_REL;
      return smoothAngle(prev, heading, a);
    };

    const applyIfDot = (sm: number) => {
      if (this.isNavModeCb?.()) {
        if (this.routeSvc.isSnapEngaged()) return;
        if (this.lastSpeedMps >= this.SPEED_TRUST_BEARING_MPS) return;
        const now = Date.now();
        if (now - this.lastNavCompassApplyAt < this.NAV_COMPASS_INTERVAL_MS) return;
        if (this.lastHeadingDeg != null &&
            Math.abs(angleDiffDeg(this.lastHeadingDeg, sm)) < 6) return;
        this.lastNavCompassApplyAt = now;
      }
      requestAnimationFrame(() => this.applyHeadingInternal(sm));
    };

    // Share one handler function for both absolute and relative orientation events
    const handler = (ev: DeviceOrientationEvent) => {
      if (!this.compassEnabled) return;
      const now = Date.now();
      if (now - this.lastCompassAt < this.COMPASS_MIN_INTERVAL_MS) return;
      this.lastCompassAt = now;
      const sm = computeHeading(ev);
      if (sm == null) return;
      this.compassHeadingDeg = sm;
      this.compassHeadingAt  = now;
      applyIfDot(sm);
    };

    this.onDeviceOrientationAbs = handler;
    this.onDeviceOrientation    = handler;

    window.addEventListener('deviceorientationabsolute' as any, this.onDeviceOrientationAbs as any, true);
    window.addEventListener('deviceorientation' as any,         this.onDeviceOrientation    as any, true);
  }

  private stopCompass(): void {
    if (!this.compassEnabled) return;
    this.compassEnabled = false;
    if (this.onDeviceOrientationAbs) {
      window.removeEventListener('deviceorientationabsolute' as any, this.onDeviceOrientationAbs as any, true);
      this.onDeviceOrientationAbs = undefined;
    }
    if (this.onDeviceOrientation) {
      window.removeEventListener('deviceorientation' as any, this.onDeviceOrientation as any, true);
      this.onDeviceOrientation = undefined;
    }
    this.lastCompassAt     = 0;
    this.compassHeadingDeg = null;
    this.compassHeadingAt  = 0;
  }
}
