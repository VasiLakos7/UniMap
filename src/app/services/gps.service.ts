import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

import { RouteService } from './route.service';
import { bearingDeg, angleDiffDeg, smoothAngle, applyMaxStep } from './map-geo.utils';

@Injectable({ providedIn: 'root' })
export class GpsService {
  public locationFound = new EventEmitter<{ lat: number; lng: number; accuracy?: number }>();
  public locationError = new EventEmitter<void>();
  public gpsStale = new EventEmitter<boolean>();

  // GPS watch IDs
  private watchId: string | null = null;
  private webWatchId: number | null = null;
  private hasInitialFix = false;

  // Jump detection
  private rawFixAt = 0;
  private rawFixLL: L.LatLng | null = null;
  private readonly JUMP_MIN_DT_S = 1.1;
  private readonly JUMP_MAX_DIST_M = 35;
  private readonly JUMP_MAX_WALK_MPS = 6.5;

  // Emit throttle
  private lastEmitAt = 0;
  private lastEmitLL: L.LatLng | null = null;
  private readonly EMIT_MIN_INTERVAL_MS = 180;
  private readonly EMIT_MIN_MOVE_M = 0.8;

  // Smoothing
  private smoothLL: L.LatLng | null = null;
  private readonly SMOOTH_ALPHA = 0.25;
  private lastMarkerLL: L.LatLng | null = null;
  private readonly MARKER_MIN_MOVE_M = 0.5;

  public lastSpeedMps = 0;
  public lastAccM = 9999;

  public lastHeadingDeg: number | null = null;
  private lastRawLL: L.LatLng | null = null;

  private readonly ACC_MAX_NATIVE_M = 45;
  private readonly ACC_MAX_WEB_M = 800;
  private readonly SPEED_USE_GPS_HEADING_MPS = 0.8;
  private readonly MIN_MOVE_FOR_BEARING_M = 1.0;
  private readonly SPEED_TRUST_BEARING_MPS = 0.45;
  private readonly ACC_TRUST_BEARING_M = 40;
  private readonly MAX_JUMP_DEG_WHEN_SLOW = 65;

  // Compass
  private compassEnabled = false;
  private lastCompassAt = 0;
  private compassHeadingDeg: number | null = null;
  private compassHeadingAt = 0;
  private onDeviceOrientationAbs?: (e: DeviceOrientationEvent) => void;
  private onDeviceOrientation?: (e: DeviceOrientationEvent) => void;
  private readonly COMPASS_MIN_INTERVAL_MS = 80;
  private readonly COMPASS_FRESH_MS = 900;
  private readonly COMPASS_DEADBAND_DEG = 4.0;
  private readonly COMPASS_SMOOTH_ALPHA_ABS = 0.38;
  private readonly COMPASS_SMOOTH_ALPHA_REL = 0.30;
  private readonly COMPASS_MAX_TURN_DPS = 360;
  private readonly COMPASS_REJECT_SPIKE_DEG = 150;
  private readonly NAV_COMPASS_INTERVAL_MS = 100; // max 10Hz in nav mode
  private lastNavCompassApplyAt = 0;

  // GPS staleness watchdog
  private staleTimer: any = null;
  private staleActive = false;
  private readonly GPS_STALE_MS = 15000;

  private updatePositionCb?: (lat: number, lng: number) => void;
  private applyHeadingCb?: (deg: number) => void;
  private mapCenterCb?: (lat: number, lng: number, zoom: number) => void;
  private isNavModeCb?: () => boolean;

  constructor(private routeSvc: RouteService) {}

  public isWatching(): boolean {
    return this.watchId !== null || this.webWatchId !== null;
  }

  private resetStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.staleActive) {
      this.staleActive = false;
      this.gpsStale.emit(false);
    }
    this.staleTimer = setTimeout(() => {
      this.staleActive = true;
      this.gpsStale.emit(true);
    }, this.GPS_STALE_MS);
  }

  registerCallbacks(
    updatePosition: (lat: number, lng: number) => void,
    applyHeading: (deg: number) => void,
    mapCenter: (lat: number, lng: number, zoom: number) => void,
    isNavMode: () => boolean
  ): void {
    this.updatePositionCb = updatePosition;
    this.applyHeadingCb = applyHeading;
    this.mapCenterCb = mapCenter;
    this.isNavModeCb = isNavMode;
  }

  // Heading helper — always use this to update heading so lastHeadingDeg stays in sync
  private applyHeadingInternal(deg: number): void {
    this.lastHeadingDeg = deg;
    this.applyHeadingCb?.(deg);
  }

  public setUserHeading(deg: number): void {
    this.applyHeadingInternal(deg);
  }

  // Accuracy cap
  private getAccMax(): number {
    return Capacitor.isNativePlatform() ? this.ACC_MAX_NATIVE_M : this.ACC_MAX_WEB_M;
  }

  // Permissions
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

  public async getInitialPosition(
    timeoutMs: number = 15000
  ): Promise<{ lat: number; lng: number } | null> {
    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) return null;

      return await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
        );
      });
    }

    const ok = await this.ensureLocationPermission();
    if (!ok) return null;

    try {
      const first = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: Math.min(timeoutMs, 10000),
        maximumAge: 0,
      });

      return { lat: first.coords.latitude, lng: first.coords.longitude };
    } catch {
      return null;
    }
  }

  // GPS Watch
  public async startGpsWatch(
    centerOnFirstFix: boolean = true,
    zoomOnFirstFix: number = 18
  ): Promise<void> {
    await this.stopGpsWatch();
    this.hasInitialFix = false;

    this.lastEmitAt = 0;
    this.lastEmitLL = null;
    this.rawFixAt = 0;
    this.rawFixLL = null;

    this.routeSvc.resetSnapState();

    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;
    this.startCompass();

    // web
    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) {
        this.locationError.emit();
        return;
      }

      const webOpts: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      };

      navigator.geolocation.getCurrentPosition(
        (pos) =>
          this.handleFix(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            (pos.coords as any).heading ?? null,
            (pos.coords as any).speed ?? null,
            centerOnFirstFix,
            zoomOnFirstFix
          ),
        () => this.locationError.emit(),
        webOpts
      );

      this.webWatchId = navigator.geolocation.watchPosition(
        (pos) =>
          this.handleFix(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            (pos.coords as any).heading ?? null,
            (pos.coords as any).speed ?? null,
            centerOnFirstFix,
            zoomOnFirstFix
          ),
        () => this.locationError.emit(),
        webOpts
      );

      return;
    }

    // native
    const ok = await this.ensureLocationPermission();
    if (!ok) {
      this.locationError.emit();
      return;
    }

    try {
      const first = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });

      this.handleFix(
        first.coords.latitude,
        first.coords.longitude,
        first.coords.accuracy,
        first.coords.heading ?? null,
        first.coords.speed ?? null,
        centerOnFirstFix,
        zoomOnFirstFix
      );
    } catch {}

    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
        (pos, err) => {
          if (err || !pos) {
            this.locationError.emit();
            return;
          }

          this.handleFix(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.accuracy,
            pos.coords.heading ?? null,
            pos.coords.speed ?? null,
            centerOnFirstFix,
            zoomOnFirstFix
          );
        }
      );
    } catch {
      this.locationError.emit();
    }
  }

  public async stopGpsWatch(): Promise<void> {
    if (this.webWatchId != null) {
      try {
        navigator.geolocation.clearWatch(this.webWatchId);
      } catch {}
      this.webWatchId = null;
    }

    if (this.watchId) {
      try {
        await Geolocation.clearWatch({ id: this.watchId });
      } catch {}
      this.watchId = null;
    }

    this.stopCompass();

    if (this.staleTimer) { clearTimeout(this.staleTimer); this.staleTimer = null; }
    if (this.staleActive) { this.staleActive = false; this.gpsStale.emit(false); }

    this.smoothLL = null;
    this.lastMarkerLL = null;
    this.lastRawLL = null;
    this.lastHeadingDeg = null;

    this.lastSpeedMps = 0;
    this.lastAccM = 9999;

    this.lastEmitAt = 0;
    this.lastEmitLL = null;
    this.rawFixAt = 0;
    this.rawFixLL = null;

    this.routeSvc.resetSnapState();

    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;
    this.lastNavCompassApplyAt = 0;
  }

  // Core fix handler
  private handleFix(
    lat: number,
    lng: number,
    accuracy?: number | null,
    heading?: number | null,
    speed?: number | null,
    centerOnFirstFix: boolean = true,
    zoomOnFirstFix: number = 18
  ): void {
    const nowMs = Date.now();

    const acc = accuracy ?? 9999;
    const accMax = this.getAccMax();
    const spd = speed ?? 0;

    this.lastSpeedMps = spd;
    this.lastAccM = acc;

    const rawNow = L.latLng(lat, lng);

    if (this.hasInitialFix) {
      const jump = this.isLikelyJump(rawNow, nowMs, acc, spd);
      if (jump) return;
    } else {
      this.rawFixLL = rawNow;
      this.rawFixAt = nowMs;
    }

    if (this.hasInitialFix && acc > accMax) return;

    // Snap to route (RouteService handles state)
    const { chosen, resetSmooth } = this.routeSvc.computeSnappedPosition(
      rawNow,
      spd,
      acc,
      (deg) => this.applyHeadingInternal(deg),
      this.lastHeadingDeg,
      this.smoothLL
    );

    if (resetSmooth) {
      this.smoothLL = chosen;
    }

    // In nav mode skip all position smoothing — pass GPS position directly for real-time response.
    let smoothed: L.LatLng;
    if (this.isNavModeCb?.()) {
      this.smoothLL = chosen;
      smoothed = chosen;
    } else {
      smoothed = this.smoothLatLng(chosen);
    }

    // Position deadband: skip marker update if position hasn't moved enough.
    // In nav mode use a very small threshold so every fix is applied immediately.
    const minMove = this.isNavModeCb?.() ? 0.1 : this.MARKER_MIN_MOVE_M;
    const markerMoved = !this.lastMarkerLL ||
      this.lastMarkerLL.distanceTo(smoothed) >= minMove;
    if (markerMoved) {
      this.lastMarkerLL = smoothed;
      this.updatePositionCb?.(smoothed.lat, smoothed.lng);
    }

    this.resetStaleTimer();

    // Emit to UI (throttled)
    if (this.shouldEmitToUI(chosen, nowMs)) {
      this.locationFound.emit({ lat: chosen.lat, lng: chosen.lng, accuracy: acc });
    }

    // Reroute (fire and forget)
    void this.routeSvc.maybeReroute(rawNow, acc, spd);

    // Arrival check
    this.routeSvc.checkArrival(rawNow, acc);

    // Heading selection
    const hLL =
      this.routeSvc.isMapMatchEnabled() && this.routeSvc.isSnapEngaged() ? chosen : rawNow;

    const usedMovement = this.updateHeadingFromMovement(hLL);

    if (!usedMovement) {
      if (typeof heading === 'number' && isFinite(heading) && spd > this.SPEED_USE_GPS_HEADING_MPS) {
        const sm = smoothAngle(this.lastHeadingDeg, heading, 0.4);
        this.applyHeadingInternal(sm);
      }
      // Compass heading is applied continuously via applyIfDot in startCompass()
      // for both nav mode (at 5Hz, 5° deadband) and non-nav mode (at 11Hz, 4° deadband).
    }

    // First-fix centering
    if (centerOnFirstFix && !this.hasInitialFix) {
      this.hasInitialFix = true;
      try {
        this.mapCenterCb?.(lat, lng, zoomOnFirstFix);
      } catch {}
      try {
        this.locationFound.emit({ lat, lng, accuracy: acc });
      } catch {}
    }
  }

  // Smoothing
  private getSmoothAlpha(): number {
    const spd = this.lastSpeedMps ?? 0;
    const acc = this.lastAccM ?? 9999;

    if (this.routeSvc.isMapMatchEnabled() && spd >= 0.8) return 0.55;
    if (spd >= 1.2) return 0.42;
    if (spd >= 0.6) return 0.32;

    if (spd < 0.3) return 0.07;  // nearly stationary: very sticky, resist GPS noise
    if (acc > 35) return 0.18;
    return this.SMOOTH_ALPHA;
  }

  private smoothLatLng(next: L.LatLng): L.LatLng {
    if (!this.smoothLL) {
      this.smoothLL = next;
      return next;
    }
    const a = this.getSmoothAlpha();
    this.smoothLL = L.latLng(
      this.smoothLL.lat + (next.lat - this.smoothLL.lat) * a,
      this.smoothLL.lng + (next.lng - this.smoothLL.lng) * a
    );
    return this.smoothLL;
  }

  // Jump detection
  private isLikelyJump(
    rawNow: L.LatLng,
    nowMs: number,
    accM: number,
    speedMps: number
  ): boolean {
    if (!this.rawFixLL || !this.rawFixAt) {
      this.rawFixLL = rawNow;
      this.rawFixAt = nowMs;
      return false;
    }

    const dtS = Math.max(0.001, (nowMs - this.rawFixAt) / 1000);
    const distM = this.rawFixLL.distanceTo(rawNow);

    this.rawFixLL = rawNow;
    this.rawFixAt = nowMs;

    if (dtS >= 6) return false;

    if (dtS >= this.JUMP_MIN_DT_S && distM > this.JUMP_MAX_DIST_M) {
      const impliedMps = distM / dtS;
      const speedSaysFast = speedMps >= 3.5;
      const accuracyBad = accM >= 18;

      if (!speedSaysFast && (impliedMps > this.JUMP_MAX_WALK_MPS || accuracyBad)) {
        return true;
      }
    }

    return false;
  }

  // Emit throttle
  private shouldEmitToUI(ll: L.LatLng, nowMs: number): boolean {
    if (!this.lastEmitLL || !this.lastEmitAt) {
      this.lastEmitLL = ll;
      this.lastEmitAt = nowMs;
      return true;
    }

    const dt = nowMs - this.lastEmitAt;
    const moved = this.lastEmitLL.distanceTo(ll);

    if (dt >= this.EMIT_MIN_INTERVAL_MS || moved >= this.EMIT_MIN_MOVE_M) {
      this.lastEmitAt = nowMs;
      this.lastEmitLL = ll;
      return true;
    }

    return false;
  }

  // Heading from movement
  private updateHeadingFromMovement(rawNow: L.LatLng): boolean {
    if (!this.lastRawLL) {
      this.lastRawLL = rawNow;
      return false;
    }

    if (this.lastAccM > this.ACC_TRUST_BEARING_M) return false;
    if (this.lastSpeedMps < this.SPEED_TRUST_BEARING_MPS) return false;

    const d = this.lastRawLL.distanceTo(rawNow);
    if (d < this.MIN_MOVE_FOR_BEARING_M) return false;

    const deg = bearingDeg(this.lastRawLL, rawNow);
    this.lastRawLL = rawNow;

    if (!isFinite(deg)) return false;

    if (this.lastHeadingDeg != null) {
      const diff = angleDiffDeg(this.lastHeadingDeg, deg);
      if (Math.abs(diff) > this.MAX_JUMP_DEG_WHEN_SLOW && this.lastSpeedMps < 1.2) {
        return false;
      }
    }

    const alpha = this.routeSvc.isMapMatchEnabled() && this.routeSvc.isSnapEngaged() ? 0.65 : 0.4;
    const sm = smoothAngle(this.lastHeadingDeg, deg, alpha);
    this.applyHeadingInternal(sm);
    return true;
  }

  // Compass
  private startCompass(): void {
    if (this.compassEnabled) return;
    this.compassEnabled = true;

    const req = (DeviceOrientationEvent as any)?.requestPermission;
    if (typeof req === 'function') {
      try {
        req().catch(() => {});
      } catch {}
    }

    const computeHeading = (ev: DeviceOrientationEvent): number | null => {
      const alpha = (ev as any).alpha;
      if (typeof alpha !== 'number' || !isFinite(alpha)) return null;

      let heading = (360 - alpha) % 360;

      const angle =
        (screen.orientation && typeof (screen.orientation as any).angle === 'number'
          ? (screen.orientation as any).angle
          : typeof (window as any).orientation === 'number'
            ? (window as any).orientation
            : 0) ?? 0;

      heading = (heading + angle + 360) % 360;

      const prev = this.compassHeadingDeg ?? this.lastHeadingDeg ?? null;

      if (prev != null) {
        const diff = angleDiffDeg(prev, heading);
        if (Math.abs(diff) < this.COMPASS_DEADBAND_DEG) return null;

        const slow = (this.lastSpeedMps ?? 0) < 0.8;
        if (slow && Math.abs(diff) >= this.COMPASS_REJECT_SPIKE_DEG) return null;

        const dtS = Math.max(
          0.016,
          (Date.now() - (this.compassHeadingAt || Date.now())) / 1000
        );
        const maxStep = this.COMPASS_MAX_TURN_DPS * dtS;
        heading = applyMaxStep(prev, heading, maxStep);
      }

      const isAbs = (ev as any).absolute === true;
      const alphaSmooth = isAbs ? this.COMPASS_SMOOTH_ALPHA_ABS : this.COMPASS_SMOOTH_ALPHA_REL;
      return smoothAngle(prev, heading, alphaSmooth);
    };

    const applyIfDot = (sm: number) => {
      if (this.isNavModeCb?.()) {
        // When snap is engaged the route geometry drives heading — compass adds noise.
        if (this.routeSvc.isSnapEngaged()) return;
        const now = Date.now();
        if (now - this.lastNavCompassApplyAt < this.NAV_COMPASS_INTERVAL_MS) return;
        const diff = this.lastHeadingDeg != null
          ? Math.abs(angleDiffDeg(this.lastHeadingDeg, sm))
          : 360;
        if (diff < 6) return;
        this.lastNavCompassApplyAt = now;
      }
      requestAnimationFrame(() => this.applyHeadingInternal(sm));
    };

    this.onDeviceOrientationAbs = (ev: DeviceOrientationEvent) => {
      if (!this.compassEnabled) return;

      const now = Date.now();
      if (now - this.lastCompassAt < this.COMPASS_MIN_INTERVAL_MS) return;
      this.lastCompassAt = now;

      const sm = computeHeading(ev);
      if (sm == null) return;

      this.compassHeadingDeg = sm;
      this.compassHeadingAt = now;

      applyIfDot(sm);
    };

    this.onDeviceOrientation = (ev: DeviceOrientationEvent) => {
      if (!this.compassEnabled) return;

      const now = Date.now();
      if (now - this.lastCompassAt < this.COMPASS_MIN_INTERVAL_MS) return;
      this.lastCompassAt = now;

      const sm = computeHeading(ev);
      if (sm == null) return;

      this.compassHeadingDeg = sm;
      this.compassHeadingAt = now;

      applyIfDot(sm);
    };

    window.addEventListener(
      'deviceorientationabsolute' as any,
      this.onDeviceOrientationAbs as any,
      true
    );
    window.addEventListener(
      'deviceorientation' as any,
      this.onDeviceOrientation as any,
      true
    );
  }

  private stopCompass(): void {
    if (!this.compassEnabled) return;
    this.compassEnabled = false;

    if (this.onDeviceOrientationAbs) {
      window.removeEventListener(
        'deviceorientationabsolute' as any,
        this.onDeviceOrientationAbs as any,
        true
      );
      this.onDeviceOrientationAbs = undefined;
    }
    if (this.onDeviceOrientation) {
      window.removeEventListener(
        'deviceorientation' as any,
        this.onDeviceOrientation as any,
        true
      );
      this.onDeviceOrientation = undefined;
    }

    this.lastCompassAt = 0;
    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;
  }
}
