import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

import { Destination, destinationList } from '../models/destination.model';
import { CampusGraphService } from './campus-graph.service';
import { RoutingService } from './routing.service';

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: L.Map;

  private userMarker!: L.Marker;
  private destinationMarker: L.Marker | null = null;
  private endApproachPolyline: L.Polyline | null = null;

  private currentPolyline: L.Polyline | null = null;
  private passedPolyline: L.Polyline | null = null;
  private approachPolyline: L.Polyline | null = null;

  private baseLayer?: L.TileLayer;
  private mapTilerKey: string | null = null;

  private lastUserLatLng: L.LatLng | null = null;
  private lastCamMoveAt = 0;
  private lastCamLL: L.LatLng | null = null;

  private readonly CAM_MIN_INTERVAL_MS = 250;
  private readonly CAM_MIN_MOVE_M = 1;

  private lastSpeedMps = 0;
  private lastAccM = 9999;
  private mapMatchEnabled = false;

  private lastSnapLL: L.LatLng | null = null;
  private snapEngaged = false;

  private readonly SNAP_ENTER_M = 12;
  private readonly SNAP_EXIT_M = 20;

  private readonly SNAP_FULL_M = 3;
  private readonly SNAP_BLEND_M = 14;
  private readonly SNAP_MIN_SPEED_MPS = 0.25;

  private lastRouteBounds: L.LatLngBounds | null = null;

  public locationFound = new EventEmitter<{ lat: number; lng: number; accuracy?: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();
  public outsideCampusClick = new EventEmitter<void>();

  public routeProgress = new EventEmitter<{
    passedMeters: number;
    remainingMeters: number;
    totalMeters: number;
    progress: number;
  }>();

  // ✅ ARRIVAL (near end pin) — emits once per navigation/route
  public arrivedNearPin = new EventEmitter<void>();
  private arrivedNearPinTriggered = false;
  private readonly ARRIVE_PIN_DIST_M = 6.0;      // 5–6m από pin (βάλε 5.5 αν θες)
  private readonly ARRIVE_PIN_MAX_ACC_M = 30;    // accuracy gate για να μην κάνει false-positive

  // -----------------------------
  // ✅ MAP LOADING OVERLAY + %
  // -----------------------------
  public mapLoadingProgress = new EventEmitter<{ loading: boolean; progress: number }>();

  private isMapLoading = false;
  private tileInflight = 0;
  private tileLoaded = 0;
  private bootLoadSessionActive = false;

  private readonly BOOT_OVERLAY_MIN_MS = 650;
  private bootLoadingStartedAt = 0;
  private bootOffTimer: any = null;

  private bootFailsafeTimer: any = null;

  private setMapLoading(loading: boolean, progress: number) {
    const p = Math.max(0, Math.min(100, Math.round(progress)));

    if (loading) {
      if (!this.isMapLoading) {
        this.bootLoadingStartedAt = Date.now();
      }
      if (this.bootOffTimer) {
        clearTimeout(this.bootOffTimer);
        this.bootOffTimer = null;
      }

      this.isMapLoading = true;
      this.mapLoadingProgress.emit({ loading: true, progress: p });
      return;
    }

    const shouldHold = this.bootLoadSessionActive && this.bootLoadingStartedAt > 0;

    if (shouldHold) {
      const elapsed = Date.now() - this.bootLoadingStartedAt;
      const wait = this.BOOT_OVERLAY_MIN_MS - elapsed;

      if (wait > 0) {
        if (this.bootOffTimer) clearTimeout(this.bootOffTimer);

        this.bootOffTimer = setTimeout(() => {
          this.bootOffTimer = null;
          this.isMapLoading = false;
          this.mapLoadingProgress.emit({ loading: false, progress: 100 });
        }, wait);

        return;
      }
    }

    if (this.bootOffTimer) {
      clearTimeout(this.bootOffTimer);
      this.bootOffTimer = null;
    }

    this.isMapLoading = false;
    this.mapLoadingProgress.emit({ loading: false, progress: 100 });
  }

  public getMapLoading(): boolean {
    return this.isMapLoading;
  }

  public firstTilesLoaded = new EventEmitter<void>();
  private firstTilesLoadedFired = false;

  private hookFirstTilesLoaded(layer?: L.TileLayer) {
    if (!layer || this.firstTilesLoadedFired) return;

    try {
      layer.once('load', () => {
        if (this.firstTilesLoadedFired) return;
        this.firstTilesLoadedFired = true;
        this.firstTilesLoaded.emit();
      });
    } catch {}
  }

  public whenFirstTilesLoaded(timeoutMs = 9000): Promise<boolean> {
    if (this.firstTilesLoadedFired) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), Math.max(600, timeoutMs));
      const sub = this.firstTilesLoaded.subscribe(() => {
        clearTimeout(t);
        sub.unsubscribe();
        resolve(true);
      });
    });
  }

  private destinationList = destinationList;
  public currentRoutePoints: L.LatLng[] = [];

  private followUser = false;
  private followZoom: number | null = null;

  private watchId: string | null = null;
  private webWatchId: number | null = null;

  private hasInitialFix = false;

  // -----------------------------
  // LIVE SMOOTH (position)
  // -----------------------------
  private animReq: number | null = null;
  private animFrom: L.LatLng | null = null;
  private animTo: L.LatLng | null = null;
  private animStart = 0;
  private lastFixAt = 0;

  private smoothLL: L.LatLng | null = null;
  private readonly SMOOTH_ALPHA = 0.25;

  // -----------------------------
  // HEADING (compass + bearing)
  // -----------------------------
  private lastRawLL: L.LatLng | null = null;
  private lastHeadingDeg: number | null = null;

  private readonly ACC_MAX_NATIVE_M = 45;
  private readonly ACC_MAX_WEB_M = 800;

  private getAccMax(): number {
    return Capacitor.isNativePlatform() ? this.ACC_MAX_NATIVE_M : this.ACC_MAX_WEB_M;
  }

  private readonly SPEED_USE_GPS_HEADING_MPS = 0.8;

  private readonly MIN_MOVE_FOR_BEARING_M = 2.5;
  private readonly SPEED_TRUST_BEARING_MPS = 0.45;
  private readonly ACC_TRUST_BEARING_M = 18;
  private readonly MAX_JUMP_DEG_WHEN_SLOW = 65;

  // -----------------------------
  // COMPASS / DEVICE ORIENTATION
  // -----------------------------
  private compassEnabled = false;
  private lastCompassAt = 0;

  private readonly COMPASS_MIN_INTERVAL_MS = 90;
  private readonly COMPASS_FRESH_MS = 900;

  private readonly COMPASS_DEADBAND_DEG = 2.2;

  private readonly COMPASS_SMOOTH_ALPHA_ABS = 0.3;
  private readonly COMPASS_SMOOTH_ALPHA_REL = 0.24;
  private readonly COMPASS_MAX_TURN_DPS = 360;
  private readonly COMPASS_REJECT_SPIKE_DEG = 95;

  private compassHeadingDeg: number | null = null;
  private compassHeadingAt = 0;

  private onDeviceOrientationAbs?: (e: DeviceOrientationEvent) => void;
  private onDeviceOrientation?: (e: DeviceOrientationEvent) => void;

  // -----------------------------
  // USER ICONS (dot / arrow)
  // -----------------------------
  private userArrowIcon = L.divIcon({
    className: 'user-marker',
    html: `<img class="user-arrow" src="assets/images/pins/arrow.png" />`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  private userDotIcon = L.divIcon({
    className: 'user-dot',
    html: `
      <div class="cone" aria-hidden="true"></div>
      <span class="dot" aria-hidden="true"></span>
      <span class="halo" aria-hidden="true"></span>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  private activeUserStyle: 'arrow' | 'dot' = 'dot';

  private lastEmitAt = 0;
  private lastEmitLL: L.LatLng | null = null;

  private rawFixAt = 0;
  private rawFixLL: L.LatLng | null = null;

  private readonly EMIT_MIN_INTERVAL_MS = 180;
  private readonly EMIT_MIN_MOVE_M = 0.8;

  private readonly JUMP_MIN_DT_S = 1.1;
  private readonly JUMP_MAX_DIST_M = 35;
  private readonly JUMP_MAX_WALK_MPS = 6.5;

  // -----------------------------
  // REROUTE (nearest snap, partial)
  // -----------------------------
  private activeDestination: Destination | null = null;
  private activeEndPoint: L.LatLng | null = null;
  private rerouteEnabled = false;

  private offRouteStreak = 0;
  private lastRerouteAt = 0;

  private readonly REROUTE_COOLDOWN_MS = 4000;
  private readonly REROUTE_CONFIRM_FIXES = 4;

  private readonly REROUTE_OFF_M = 24;
  private readonly REROUTE_ON_M = 12;
  private readonly REROUTE_MAX_ACC_M = 25;
  private readonly REROUTE_MIN_SPEED_MPS = 0.35;

  private readonly REROUTE_SKIP_NEAR_DEST_M = 45;
  private readonly REROUTE_FULL_REBUILD_M = 9999;

  public setUserMarkerStyle(style: 'arrow' | 'dot') {
    this.activeUserStyle = style;

    if (!this.userMarker) return;
    const icon = style === 'arrow' ? this.userArrowIcon : this.userDotIcon;
    this.userMarker.setIcon(icon);

    if (this.lastHeadingDeg != null) {
      setTimeout(() => this.applyHeading(this.lastHeadingDeg!), 0);
    }
  }

  public setNavigationMode(active: boolean) {
    this.setUserMarkerStyle(active ? 'arrow' : 'dot');
    this.mapMatchEnabled = active;

    this.rerouteEnabled = active;
    if (!active) {
      this.offRouteStreak = 0;
      this.lastRerouteAt = 0;
    }

    if (!active) {
      this.snapEngaged = false;
      this.lastSnapLL = null;
    }
  }

  // -----------------------------
  // Destination pin icon
  // -----------------------------
  private destIcon = L.icon({
    iconUrl: 'assets/images/pins/end-pin.png',
    iconSize: [45, 45],
    iconAnchor: [22, 45],
  });

  constructor(private graphService: CampusGraphService, private routingService: RoutingService) {}

  // -----------------------------
  // Campus polygon
  // -----------------------------
  private campusBoundary = L.polygon([
    [40.659484, 22.801706],
    [40.659338, 22.806507],
    [40.654901, 22.806625],
    [40.6555, 22.80184],
  ]);

  private isInsideCampus(lat: number, lng: number): boolean {
    const polygon = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    const x = lng;
    const y = lat;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng,
        yi = polygon[i].lat;
      const xj = polygon[j].lng,
        yj = polygon[j].lat;

      const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  public isPointInsideCampusLoose(lat: number, lng: number, marginM: number = 45): boolean {
    if (this.isInsideCampus(lat, lng)) return true;

    const ring = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    if (!ring || ring.length < 3) return false;

    const P = L.CRS.EPSG3857.project(L.latLng(lat, lng));
    let minDist = Infinity;

    const distPointToSegment = (p: L.Point, a: L.Point, b: L.Point) => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const apx = p.x - a.x;
      const apy = p.y - a.y;

      const ab2 = abx * abx + aby * aby;
      if (ab2 <= 1e-7) {
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
      }

      let t = (apx * abx + apy * aby) / ab2;
      t = Math.max(0, Math.min(1, t));

      const cx = a.x + t * abx;
      const cy = a.y + t * aby;

      const dx = p.x - cx;
      const dy = p.y - cy;
      return Math.sqrt(dx * dx + dy * dy);
    };

    for (let i = 0; i < ring.length; i++) {
      const aLL = ring[i];
      const bLL = ring[(i + 1) % ring.length];

      const A = L.CRS.EPSG3857.project(aLL);
      const B = L.CRS.EPSG3857.project(bLL);

      const d = distPointToSegment(P, A, B);
      if (d < minDist) minDist = d;
    }

    return minDist <= marginM;
  }

  public isPointInsideCampus(lat: number, lng: number): boolean {
    return this.isInsideCampus(lat, lng);
  }

  // -----------------------------
  // FOLLOW + RECENTER
  // -----------------------------
  public setFollowUser(enabled: boolean, zoom?: number) {
    this.followUser = enabled;
    this.followZoom = typeof zoom === 'number' ? zoom : null;

    if (enabled) {
      this.lastCamMoveAt = 0;
      this.lastCamLL = null;
    }
  }

  public recenterToUser(opts?: { zoom?: number; animate?: boolean; follow?: boolean }): boolean {
    if (!this.map) return false;
    if (!this.lastUserLatLng) return false;

    const zoom = opts?.zoom ?? Math.max(this.map.getZoom(), 18);
    const animate = opts?.animate ?? true;

    this.map.setView(this.lastUserLatLng, zoom, { animate });

    if (opts?.follow) {
      this.setFollowUser(true, zoom);
    }

    return true;
  }

  // -----------------------------
  // Permissions / Initial position
  // -----------------------------
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

  public async getInitialPosition(timeoutMs: number = 15000): Promise<{ lat: number; lng: number } | null> {
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

  // ----------------------------
  // Tile loading progress hook
  // -----------------------------
  private hookTileLoadingProgress(layer?: L.TileLayer) {
    if (!layer) return;

    // reset state
    this.tileInflight = 0;
    this.tileLoaded = 0;

    const emit = () => {
      if (!this.bootLoadSessionActive) return;

      const denom = this.tileLoaded + this.tileInflight;
      const ratio = denom > 0 ? this.tileLoaded / denom : 0;

      const prog = this.isMapLoading ? Math.max(2, Math.round(ratio * 100)) : 100;
      this.setMapLoading(this.isMapLoading, prog);
    };

    layer.on('loading', () => {
      if (!this.bootLoadSessionActive) return;

      this.tileInflight = 0;
      this.tileLoaded = 0;
      this.setMapLoading(true, 2);
    });

    layer.on('tileloadstart', () => {
      if (!this.bootLoadSessionActive) return;

      this.tileInflight++;
      emit();
    });

    const onTileDone = () => {
      if (!this.bootLoadSessionActive) return;

      this.tileInflight = Math.max(0, this.tileInflight - 1);
      this.tileLoaded++;
      emit();
    };

    layer.on('tileload', onTileDone);
    layer.on('tileerror', onTileDone);

    layer.on('load', () => {
      if (!this.bootLoadSessionActive) return;

      this.tileInflight = 0;
      this.setMapLoading(false, 100);

      if (this.bootFailsafeTimer) {
        clearTimeout(this.bootFailsafeTimer);
        this.bootFailsafeTimer = null;
      }

      setTimeout(() => {
        this.bootLoadSessionActive = false;
      }, 150);
    });
  }

  // -----------------------------
  // MAP INIT
  // -----------------------------
  initializeMap(lat: number, lng: number, elementId: string) {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }

    this.firstTilesLoadedFired = false;

    this.bootLoadSessionActive = true;
    this.bootLoadingStartedAt = 0;

    if (this.bootOffTimer) {
      clearTimeout(this.bootOffTimer);
      this.bootOffTimer = null;
    }

    this.setMapLoading(true, 2);

    if (this.bootFailsafeTimer) clearTimeout(this.bootFailsafeTimer);
    this.bootFailsafeTimer = setTimeout(() => {
      if (this.bootLoadSessionActive) {
        this.tileInflight = 0;
        this.setMapLoading(false, 100);
        this.bootLoadSessionActive = false;
      }
    }, 12000);

    this.map = L.map(elementId, {
      zoomControl: false,
      keyboard: true,
      maxZoom: 22,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
    }).setView([lat, lng], 18);

    this.mapTilerKey = 'fFUNZQgQLPQX2iZWUJ8w';

    // default
    this.setBaseLayer('maptiler-osm', this.mapTilerKey);

    this.setUserMarkerStyle(this.activeUserStyle);
    this.setupUserMarker(lat, lng);
    this.updateUserPosition(lat, lng);

    this.setupMapClickEvent();
    this.setupFreePanHandlers();
  }

  private setupFreePanHandlers() {
    if (!this.map) return;

    const stopFollowIfUser = (e: any) => {
      if (!this.followUser) return;
      if (!e?.originalEvent) return;
      this.setFollowUser(false);
    };

    this.map.on('dragstart', stopFollowIfUser);
    this.map.on('zoomstart', stopFollowIfUser);
    this.map.on('movestart', stopFollowIfUser);
  }

  private setupUserMarker(lat: number, lng: number) {
    if (!this.map) return;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
      return;
    }

    this.userMarker = L.marker([lat, lng], {
      icon: this.activeUserStyle === 'arrow' ? this.userArrowIcon : this.userDotIcon,
    }).addTo(this.map);
  }

  public refreshMap() {
    if (!this.map) return;
    setTimeout(() => {
      this.map.invalidateSize(true);
      try {
        this.baseLayer?.redraw?.();
      } catch {}
    }, 60);
  }

  public focusOn(lat: number, lng: number, zoom: number = 19) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  // -----------------------------
  // COMPASS START/STOP
  // -----------------------------
  private startCompass() {
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
        const diff = this.angleDiffDeg(prev, heading);
        if (Math.abs(diff) < this.COMPASS_DEADBAND_DEG) return null;

        const slow = (this.lastSpeedMps ?? 0) < 0.8;
        if (slow && Math.abs(diff) >= this.COMPASS_REJECT_SPIKE_DEG) return null;

        const dtS = Math.max(0.016, (Date.now() - (this.compassHeadingAt || Date.now())) / 1000);
        const maxStep = this.COMPASS_MAX_TURN_DPS * dtS;
        heading = this.applyMaxStep(prev, heading, maxStep);
      }

      const isAbs = (ev as any).absolute === true;
      const alphaSmooth = isAbs ? this.COMPASS_SMOOTH_ALPHA_ABS : this.COMPASS_SMOOTH_ALPHA_REL;
      return this.smoothAngle(prev, heading, alphaSmooth);
    };

    const applyIfDot = (sm: number) => {
      if (this.activeUserStyle !== 'dot') return;
      requestAnimationFrame(() => this.applyHeading(sm));
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

    window.addEventListener('deviceorientationabsolute' as any, this.onDeviceOrientationAbs as any, true);
    window.addEventListener('deviceorientation' as any, this.onDeviceOrientation as any, true);
  }

  private stopCompass() {
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

    this.lastCompassAt = 0;
    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;
  }

  // -----------------------------
  // GPS WATCH
  // -----------------------------
  public async startGpsWatch(centerOnFirstFix: boolean = true, zoomOnFirstFix: number = 18) {
    await this.stopGpsWatch();
    this.hasInitialFix = false;

    this.lastEmitAt = 0;
    this.lastEmitLL = null;
    this.rawFixAt = 0;
    this.rawFixLL = null;

    this.snapEngaged = false;
    this.lastSnapLL = null;

    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;
    this.startCompass();

    // -------- WEB --------
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

    // -------- NATIVE --------
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

  public async stopGpsWatch() {
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

    if (this.animReq) {
      cancelAnimationFrame(this.animReq);
      this.animReq = null;
    }

    this.animFrom = null;
    this.animTo = null;
    this.smoothLL = null;

    this.lastRawLL = null;
    this.lastHeadingDeg = null;

    this.lastFixAt = 0;
    this.lastSpeedMps = 0;
    this.lastAccM = 9999;

    this.lastEmitAt = 0;
    this.lastEmitLL = null;
    this.rawFixAt = 0;
    this.rawFixLL = null;

    this.snapEngaged = false;
    this.lastSnapLL = null;

    this.compassHeadingDeg = null;
    this.compassHeadingAt = 0;

    this.offRouteStreak = 0;
    this.lastRerouteAt = 0;
  }

  public setUserHeading(deg: number) {
    this.applyHeading(deg);
  }

  private applyHeading(deg: number) {
    if (!this.userMarker) return;
    const el = this.userMarker.getElement();
    if (!el) return;

    this.lastHeadingDeg = deg;

    const img = el.querySelector('img.user-arrow') as HTMLImageElement | null;
    if (img) {
      img.style.transformOrigin = '50% 50%';
      img.style.transform = `rotate(${deg}deg)`;
    }

    const cone = el.querySelector('.cone') as HTMLElement | null;
    if (cone) {
      cone.style.transformOrigin = '50% 50%';
      cone.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
      cone.style.opacity = '0.24';
    }
  }

  private angleDiffDeg(a: number, b: number): number {
    return ((b - a + 540) % 360) - 180;
  }

  private applyMaxStep(prev: number, next: number, maxStep: number): number {
    const d = this.angleDiffDeg(prev, next);
    if (Math.abs(d) <= maxStep) return next;
    const limited = prev + Math.sign(d) * maxStep;
    return (limited + 360) % 360;
  }

  private smoothAngle(prev: number | null, next: number, alpha = 0.25): number {
    if (prev == null) return next;
    const diff = this.angleDiffDeg(prev, next);
    return (prev + diff * alpha + 360) % 360;
  }

  // -----------------------------
  // helpers: jump + emit throttle
  // -----------------------------
  private isLikelyJump(rawNow: L.LatLng, nowMs: number, accM: number, speedMps: number): boolean {
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

  // -----------------------------
  // snap helpers
  // -----------------------------
  private closestPointOnSegmentMeters(p: L.Point, a: L.Point, b: L.Point): { pt: L.Point; dist: number } {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;

    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-9) {
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      return { pt: a, dist: Math.sqrt(dx * dx + dy * dy) };
    }

    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));

    const cx = a.x + t * abx;
    const cy = a.y + t * aby;

    const dx = p.x - cx;
    const dy = p.y - cy;

    return { pt: L.point(cx, cy), dist: Math.sqrt(dx * dx + dy * dy) };
  }

  private snapToCurrentRoute(raw: L.LatLng): { snapped: L.LatLng; distM: number } | null {
    const pts = this.currentRoutePoints;
    if (!pts || pts.length < 2) return null;

    const P = L.CRS.EPSG3857.project(raw);

    let bestD = Infinity;
    let bestPt: L.Point | null = null;

    for (let i = 0; i < pts.length - 1; i++) {
      const A = L.CRS.EPSG3857.project(pts[i]);
      const B = L.CRS.EPSG3857.project(pts[i + 1]);

      const res = this.closestPointOnSegmentMeters(P, A, B);
      if (res.dist < bestD) {
        bestD = res.dist;
        bestPt = res.pt;
      }
    }

    if (!bestPt) return null;

    const snappedLL = L.CRS.EPSG3857.unproject(bestPt);
    return { snapped: snappedLL, distM: bestD };
  }

  private snapToRouteWithIndex(raw: L.LatLng): { snap: L.LatLng; segStartIndex: number; distM: number } | null {
    const pts = this.currentRoutePoints;
    if (!pts || pts.length < 2) return null;

    const P = L.CRS.EPSG3857.project(raw);

    let bestD = Infinity;
    let bestPt: L.Point | null = null;
    let bestI = -1;

    for (let i = 0; i < pts.length - 1; i++) {
      const A = L.CRS.EPSG3857.project(pts[i]);
      const B = L.CRS.EPSG3857.project(pts[i + 1]);

      const res = this.closestPointOnSegmentMeters(P, A, B);
      if (res.dist < bestD) {
        bestD = res.dist;
        bestPt = res.pt;
        bestI = i;
      }
    }

    if (!bestPt || bestI < 0) return null;

    return { snap: L.CRS.EPSG3857.unproject(bestPt), segStartIndex: bestI, distM: bestD };
  }

  // -----------------------------
  // REROUTE logic
  // -----------------------------
  private async maybeReroute(rawNow: L.LatLng, accM: number, spdMps: number) {
    if (!this.rerouteEnabled) return;
    if (!this.mapMatchEnabled) return;
    if (!this.activeDestination) return;
    if (!this.currentRoutePoints || this.currentRoutePoints.length < 2) return;

    const now = Date.now();
    if (now - this.lastRerouteAt < this.REROUTE_COOLDOWN_MS) return;

    if (!isFinite(accM) || accM > this.REROUTE_MAX_ACC_M) return;
    if ((spdMps ?? 0) < this.REROUTE_MIN_SPEED_MPS) return;

    const dLat = this.activeDestination.entranceLat ?? this.activeDestination.lat;
    const dLng = this.activeDestination.entranceLng ?? this.activeDestination.lng;
    const endLL = L.latLng(dLat, dLng);
    const distToEnd = rawNow.distanceTo(endLL);
    if (isFinite(distToEnd) && distToEnd <= this.REROUTE_SKIP_NEAR_DEST_M) {
      this.offRouteStreak = 0;
      return;
    }

    const snap = this.snapToRouteWithIndex(rawNow);
    if (!snap) return;

    const offM = snap.distM;

    if (offM <= this.REROUTE_ON_M) {
      this.offRouteStreak = 0;
      return;
    }

    if (offM >= this.REROUTE_OFF_M) {
      this.offRouteStreak++;
    } else {
      // stay
    }

    if (this.offRouteStreak < this.REROUTE_CONFIRM_FIXES) return;

    this.offRouteStreak = 0;
    this.lastRerouteAt = now;

    if (offM >= this.REROUTE_FULL_REBUILD_M) {
      await this.drawCustomRouteToDestination(this.activeDestination, rawNow, { fit: false });
      return;
    }

    this.applyPartialRerouteFromSnap(rawNow, snap.snap, snap.segStartIndex);
  }

  private applyPartialRerouteFromSnap(rawNow: L.LatLng, snapPoint: L.LatLng, segStartIndex: number) {
    if (!this.map) return;

    this.clearRouteLayers();

    const rest: L.LatLng[] = [];
    rest.push(snapPoint);

    const tail = this.currentRoutePoints.slice(segStartIndex + 1);
    for (const p of tail) {
      if (rest.length === 0 || !this.almostSame(rest[rest.length - 1], p)) rest.push(p);
    }

    const newPts: L.LatLng[] = [];
    newPts.push(rawNow);
    for (const p of rest) {
      if (newPts.length === 0 || !this.almostSame(newPts[newPts.length - 1], p)) newPts.push(p);
    }
    this.currentRoutePoints = newPts;

    if (rawNow.distanceTo(snapPoint) > 1) {
      this.approachPolyline = L.polyline([rawNow, snapPoint], {
        color: '#666666',
        weight: 3,
        opacity: 0.75,
        dashArray: '4 8',
      }).addTo(this.map);
    }

    if (rest.length >= 3) {
      const solid = rest.slice(0, -1);
      this.currentPolyline = L.polyline(solid, {
        color: '#007bff',
        weight: 6,
        opacity: 0.9,
      }).addTo(this.map);

      this.drawEndApproach(rest[rest.length - 2], rest[rest.length - 1]);
    } else if (rest.length === 2) {
      this.drawEndApproach(rest[0], rest[1]);
    }

    const totalMeters = this.getCurrentRouteDistanceMeters();
    this.routeProgress.emit({
      passedMeters: 0,
      remainingMeters: totalMeters,
      totalMeters,
      progress: 0,
    });
  }

  // -----------------------------
  // Fix handler (live + heading)
  // -----------------------------
  private handleFix(
    lat: number,
    lng: number,
    accuracy?: number | null,
    heading?: number | null,
    speed?: number | null,
    centerOnFirstFix: boolean = true,
    zoomOnFirstFix: number = 18
  ) {
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

    let chosen = rawNow;

    if (this.mapMatchEnabled && this.currentRoutePoints.length >= 2) {
      const canSnap = spd >= this.SNAP_MIN_SPEED_MPS || acc <= 20;

      if (canSnap) {
        const snap = this.snapToCurrentRoute(rawNow);

        if (snap) {
          const d = snap.distM;

          if (!this.snapEngaged) {
            if (d <= this.SNAP_ENTER_M) {
              this.snapEngaged = true;
              this.lastSnapLL = snap.snapped;
            }
          } else {
            if (d >= this.SNAP_EXIT_M) {
              this.snapEngaged = false;
              this.lastSnapLL = null;
            }
          }

          if (this.snapEngaged) {
            const prevSnap = this.lastSnapLL;

            let target = snap.snapped;
            if (prevSnap) {
              const a = 0.35;
              target = L.latLng(
                prevSnap.lat + (target.lat - prevSnap.lat) * a,
                prevSnap.lng + (target.lng - prevSnap.lng) * a
              );
            }

            if (prevSnap) {
              const moved = prevSnap.distanceTo(target);
              if (moved >= 0.8) {
                const deg = this.bearingDeg(prevSnap, target);
                const sm = this.smoothAngle(this.lastHeadingDeg, deg, 0.25);
                this.applyHeading(sm);
              }
            }

            this.lastSnapLL = target;

            const w =
              d <= this.SNAP_FULL_M
                ? 0.97
                : d >= this.SNAP_BLEND_M
                  ? 0.45
                  : 0.97 - (d - this.SNAP_FULL_M) * (0.52 / (this.SNAP_BLEND_M - this.SNAP_FULL_M));

            chosen = L.latLng(
              rawNow.lat + (target.lat - rawNow.lat) * w,
              rawNow.lng + (target.lng - rawNow.lng) * w
            );

            if (!this.smoothLL || this.smoothLL.distanceTo(chosen) > 5) {
              this.smoothLL = chosen;
            }
          }
        }
      } else {
        this.snapEngaged = false;
        this.lastSnapLL = null;
      }
    }

    // θέση
    this.updateUserPosition(chosen.lat, chosen.lng);
    if (this.shouldEmitToUI(chosen, nowMs)) {
      this.locationFound.emit({ lat: chosen.lat, lng: chosen.lng, accuracy: acc });
    }

    void this.maybeReroute(rawNow, acc, spd);

    // ✅ ARRIVAL: 5–6m από το τελικό pin (μόνο όταν είμαστε σε navigation mode)
    if (!this.arrivedNearPinTriggered && this.mapMatchEnabled && this.activeEndPoint && this.currentRoutePoints.length >= 2) {
      const accOk = isFinite(acc) && acc <= this.ARRIVE_PIN_MAX_ACC_M;
      if (accOk) {
        const d = rawNow.distanceTo(this.activeEndPoint);
        if (isFinite(d) && d <= this.ARRIVE_PIN_DIST_M) {
          this.arrivedNearPinTriggered = true;
          this.arrivedNearPin.emit();
        }
      }
    }

    // -----------------------------
    // HEADING επιλογή
    // -----------------------------
    const hLL = this.mapMatchEnabled && this.snapEngaged ? chosen : rawNow;

    const usedMovement = this.updateHeadingFromMovement(hLL);

    if (!usedMovement) {
      if (typeof heading === 'number' && isFinite(heading) && spd > this.SPEED_USE_GPS_HEADING_MPS) {
        const sm = this.smoothAngle(this.lastHeadingDeg, heading, 0.18);
        this.applyHeading(sm);
      } else {
        const compassFresh = Date.now() - (this.compassHeadingAt || 0) < this.COMPASS_FRESH_MS;
        if (compassFresh && this.compassHeadingDeg != null) {
          const slow = (this.lastSpeedMps ?? 0) < 0.8;
          const a = slow ? 0.08 : 0.12;
          const sm = this.smoothAngle(this.lastHeadingDeg, this.compassHeadingDeg, a);
          this.applyHeading(sm);
        }
      }
    }

    if (centerOnFirstFix && !this.hasInitialFix && this.map) {
      this.hasInitialFix = true;
      try {
        this.map.setView([lat, lng], zoomOnFirstFix, { animate: true });
      } catch {}
      try {
        this.locationFound.emit({ lat, lng, accuracy: acc });
      } catch {}
    }
  }

  // -----------------------------
  // USER MARKER + LIVE FOLLOW CAMERA
  // -----------------------------
  public updateUserPosition(lat: number, lng: number) {
    const raw = L.latLng(lat, lng);
    const ll = this.smoothLatLng(raw);

    this.lastUserLatLng = ll;
    this.animateUserMarkerTo(ll);
  }

  private getSmoothAlpha(): number {
    const spd = this.lastSpeedMps ?? 0;
    const acc = this.lastAccM ?? 9999;

    if (this.mapMatchEnabled && spd >= 0.8) return 0.55;
    if (spd >= 1.2) return 0.42;
    if (spd >= 0.6) return 0.32;

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

  private animateUserMarkerTo(next: L.LatLng) {
    if (!this.userMarker) return;

    if (!this.animTo) {
      this.userMarker.setLatLng(next);
      this.animTo = next;
      return;
    }

    const now = performance.now();
    const dt = this.lastFixAt ? now - this.lastFixAt : 450;
    this.lastFixAt = now;

    const durationMs = Math.max(140, Math.min(420, dt * 0.55));

    this.animFrom = this.userMarker.getLatLng();
    this.animTo = next;
    const distM = this.animFrom.distanceTo(next);

    if (distM > 6) {
      this.userMarker.setLatLng(next);

      if (this.map && this.followUser) {
        const z = this.followZoom ?? this.map.getZoom();
        this.map.panTo(next, { animate: false });
        if (this.map.getZoom() !== z) this.map.setZoom(z);
      }

      this.animFrom = next;
      this.animTo = next;
      return;
    }

    this.animStart = now;
    if (this.animReq) cancelAnimationFrame(this.animReq);

    const step = (t: number) => {
      if (!this.animFrom || !this.animTo) return;

      const k = Math.min(1, (t - this.animStart) / durationMs);
      const lat = this.animFrom.lat + (this.animTo.lat - this.animFrom.lat) * k;
      const lng = this.animFrom.lng + (this.animTo.lng - this.animFrom.lng) * k;

      const cur = L.latLng(lat, lng);
      this.userMarker.setLatLng(cur);

      if (this.map && this.followUser) {
        const nowMs = Date.now();
        const movedM = this.lastCamLL ? this.lastCamLL.distanceTo(cur) : Infinity;

        const tooSoon = nowMs - this.lastCamMoveAt < this.CAM_MIN_INTERVAL_MS;
        const tooSmall = movedM < this.CAM_MIN_MOVE_M;

        if (!(tooSoon && tooSmall)) {
          this.lastCamMoveAt = nowMs;
          this.lastCamLL = cur;

          const z = this.followZoom ?? this.map.getZoom();
          this.map.panTo(cur, { animate: false });
          if (this.map.getZoom() !== z) this.map.setZoom(z);
        }
      }

      if (k < 1) this.animReq = requestAnimationFrame(step);
    };

    this.animReq = requestAnimationFrame(step);
  }

  private updateHeadingFromMovement(rawNow: L.LatLng): boolean {
    if (!this.lastRawLL) {
      this.lastRawLL = rawNow;
      return false;
    }

    if (this.lastAccM > this.ACC_TRUST_BEARING_M) return false;
    if (this.lastSpeedMps < this.SPEED_TRUST_BEARING_MPS) return false;

    const d = this.lastRawLL.distanceTo(rawNow);
    if (d < this.MIN_MOVE_FOR_BEARING_M) return false;

    const deg = this.bearingDeg(this.lastRawLL, rawNow);
    this.lastRawLL = rawNow;

    if (!isFinite(deg)) return false;

    if (this.lastHeadingDeg != null) {
      const diff = this.angleDiffDeg(this.lastHeadingDeg, deg);
      if (Math.abs(diff) > this.MAX_JUMP_DEG_WHEN_SLOW && this.lastSpeedMps < 1.2) {
        return false;
      }
    }

    const sm = this.smoothAngle(this.lastHeadingDeg, deg, 0.18);
    this.applyHeading(sm);
    return true;
  }

  private bearingDeg(from: L.LatLng, to: L.LatLng): number {
    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const dLng = ((to.lng - from.lng) * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const brng = Math.atan2(y, x);
    const deg = (brng * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  // -----------------------------
  // BASE LAYER
  // -----------------------------
  private setBaseLayer(style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm', apiKey?: string) {
    if (!this.map) return;

    if (this.baseLayer) this.map.removeLayer(this.baseLayer);

    const commonOpt: L.TileLayerOptions = {
      maxZoom: 22,
      maxNativeZoom: 19,
      keepBuffer: 6,
    };

    const layers: Record<string, { url: string; opt: L.TileLayerOptions }> = {
      osm: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opt: { attribution: '© OpenStreetMap contributors', ...commonOpt },
      },
      positron: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO', ...commonOpt },
      },
      dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO', ...commonOpt },
      },
      'maptiler-outdoor': {
        url: `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: {
          attribution: '© OpenStreetMap | © MapTiler',
          tileSize: 512,
          zoomOffset: -1,
          ...commonOpt,
        },
      },
      'maptiler-osm': {
        url: `https://api.maptiler.com/maps/openstreetmap/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: {
          attribution: '© OpenStreetMap | © MapTiler',
          tileSize: 512,
          zoomOffset: -1,
          ...commonOpt,
        },
      },
    };

    this.baseLayer = L.tileLayer(layers[style].url, layers[style].opt).addTo(this.map);

    this.hookFirstTilesLoaded(this.baseLayer);
    this.hookTileLoadingProgress(this.baseLayer);

    if (this.bootLoadSessionActive) {
      this.setMapLoading(true, 2);
    }
  }

  public setBaseLayerFromSettings(mode: string) {
    const style =
      mode === 'osm'
        ? 'osm'
        : mode === 'positron'
          ? 'positron'
          : mode === 'dark'
            ? 'dark'
            : mode === 'maptiler-outdoor'
              ? 'maptiler-outdoor'
              : mode === 'maptiler-osm'
                ? 'maptiler-osm'
                : mode === 'maptiler'
                  ? 'maptiler-osm'
                  : 'osm';

    const needsKey = style === 'maptiler-outdoor' || style === 'maptiler-osm';

    this.setBaseLayer(style as any, needsKey ? this.mapTilerKey ?? undefined : undefined);
    this.refreshMap();
  }

  private getDestPoint(dest: Destination, mode: 'center' | 'entrance' = 'center'): L.LatLng {
    if (mode === 'entrance' && dest.entranceLat != null && dest.entranceLng != null) {
      return L.latLng(dest.entranceLat, dest.entranceLng);
    }
    return L.latLng(dest.lat, dest.lng);
  }

  public pinDestinationByMode(dest: Destination, mode: 'center' | 'entrance' = 'center', label?: string) {
    const ll = this.getDestPoint(dest, mode);
    this.pinDestination(ll.lat, ll.lng, label ?? dest.name);
  }

  // -----------------------------
  // CLICK SNAP TO NEAR DESTINATION
  // -----------------------------
  private findNearestDestinationWithin(
    lat: number,
    lng: number,
    maxMeters = 40,
    mode: 'center' | 'entrance' = 'center'
  ): Destination | undefined {
    const here = L.latLng(lat, lng);

    let best: { d: number; dest: Destination } | undefined;

    for (const dest of this.destinationList) {
      const ll = this.getDestPoint(dest, mode);
      const dist = here.distanceTo(ll);

      if (dist <= maxMeters && (!best || dist < best.d)) {
        best = { d: dist, dest };
      }
    }

    return best?.dest;
  }

  // -----------------------------
  // MAP CLICK
  // -----------------------------
  private setupMapClickEvent() {
    if (!this.map) return;

    this.map.on('click', async (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      if (this.isMapLoading) return;

      const insideStrict = this.isInsideCampus(clickedLat, clickedLng);
      if (!insideStrict) {
        const insideLoose = this.isPointInsideCampusLoose(clickedLat, clickedLng, 45);
        if (insideLoose) return;
        this.outsideCampusClick.emit();
        return;
      }

      let found = this.destinationList.find((dest: Destination) => {
        const b = dest.bounds;
        if (!b) return false;
        return clickedLat >= b.south && clickedLat <= b.north && clickedLng >= b.west && clickedLng <= b.east;
      });

      if (!found) {
        found = this.findNearestDestinationWithin(clickedLat, clickedLng, 40, 'center');
      }

      this.mapClicked.emit({
        lat: clickedLat,
        lng: clickedLng,
        name: found ? found.name : null,
      });
    });
  }

  // -----------------------------
  // DEST PIN
  // -----------------------------
  public pinDestination(lat: number, lng: number, label?: string) {
    if (!this.map) return;

    const to = L.latLng(lat, lng);

    if (!this.destinationMarker) {
      this.destinationMarker = L.marker(to, { icon: this.destIcon }).addTo(this.map);
    } else {
      this.destinationMarker.setLatLng(to);
    }

    if (label) {
      this.destinationMarker.unbindTooltip();
      this.destinationMarker.bindTooltip(label, {
        direction: 'top',
        offset: L.point(12, -45),
        opacity: 0.95,
      });
    }
  }

  private drawEndApproach(from: L.LatLng, to: L.LatLng) {
    if (!this.map) return;

    if (this.endApproachPolyline) {
      try {
        this.map.removeLayer(this.endApproachPolyline);
      } catch {}
      this.endApproachPolyline = null;
    }

    if (!from || !to) return;
    if (from.distanceTo(to) < 0.6) return;

    this.endApproachPolyline = L.polyline([from, to], {
      color: '#007bff',
      weight: 6,
      opacity: 0.9,
      dashArray: '10 14',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(this.map);
  }

  // -----------------------------
  // ROUTING (custom graph)
  // -----------------------------
  private sumDistanceMeters(points: L.LatLng[]): number {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) total += points[i - 1].distanceTo(points[i]);
    return total;
  }

  public getCurrentRouteDistanceMeters(): number {
    return this.sumDistanceMeters(this.currentRoutePoints);
  }

  private clearRouteLayers() {
    if (!this.map) return;

    if (this.currentPolyline) {
      this.map.removeLayer(this.currentPolyline);
      this.currentPolyline = null;
    }
    if (this.passedPolyline) {
      this.map.removeLayer(this.passedPolyline);
      this.passedPolyline = null;
    }
    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }
    if (this.endApproachPolyline) {
      this.map.removeLayer(this.endApproachPolyline);
      this.endApproachPolyline = null;
    }

    this.routingService.removeRouting(this.map);
  }

  private almostSame(a: L.LatLng, b: L.LatLng, epsM: number = 0.7): boolean {
    return a.distanceTo(b) <= epsM;
  }

  public async drawCustomRouteToDestination(dest: Destination, startPoint: L.LatLng, opts?: { fit?: boolean }) {
    if (!this.map) return;

    // ✅ reset arrival trigger για νέο route
    this.arrivedNearPinTriggered = false;

    this.activeDestination = dest;
    this.rerouteEnabled = true;
    this.offRouteStreak = 0;

    this.clearRouteLayers();

    const destLat = dest.entranceLat ?? dest.lat;
    const destLng = dest.entranceLng ?? dest.lng;
    const endPoint = L.latLng(destLat, destLng);
    this.activeEndPoint = endPoint; // ✅

    this.pinDestination(destLat, destLng, dest.name);

    const APPROACH_START_M = 38;
    const distToDestNow = startPoint.distanceTo(endPoint);

    if (isFinite(distToDestNow) && distToDestNow <= APPROACH_START_M) {
      this.currentRoutePoints = [startPoint, endPoint];

      this.drawEndApproach(startPoint, endPoint);

      const bounds = L.latLngBounds([startPoint, endPoint]);
      this.lastRouteBounds = bounds;

      if (opts?.fit !== false) {
        this.map.fitBounds(bounds, {
          paddingTopLeft: [30, 140],
          paddingBottomRight: [30, 260],
          maxZoom: 19,
          animate: true,
          duration: 0.7,
        });
      }

      const totalMeters = this.getCurrentRouteDistanceMeters();
      this.routeProgress.emit({
        passedMeters: 0,
        remainingMeters: totalMeters,
        totalMeters,
        progress: 0,
      });
      return;
    }

    // =============================
    //  GRAPH ROUTE
    // =============================
    let endNodeId = this.graphService.getNodeIdForName(dest.name) || this.graphService.findNearestNodeId(destLat, destLng);
    if (!endNodeId) return;

    let startNodeId: string | null = this.graphService.findNearestNodeId(startPoint.lat, startPoint.lng);

    if (!startNodeId) {
      startNodeId = this.graphService.findBestStartNodeForDestination(startPoint.lat, startPoint.lng, endNodeId);
    }
    if (!startNodeId) return;

    const pathNodes = this.graphService.calculatePath(startNodeId, endNodeId);
    if (!pathNodes || pathNodes.length < 1) return;

    const startNodeCoords = this.graphService.getDestinationCoords(startNodeId);
    if (!startNodeCoords) return;

    const mainRoutePoints: L.LatLng[] = [...pathNodes];
    const END_TRIM_TOL_M = 2.0;
    const dist = (p: L.LatLng) => p.distanceTo(endPoint);

    while (mainRoutePoints.length >= 3) {
      const last = mainRoutePoints[mainRoutePoints.length - 1];
      const prev = mainRoutePoints[mainRoutePoints.length - 2];

      if (dist(last) > dist(prev) + END_TRIM_TOL_M) {
        mainRoutePoints.pop();
      } else {
        break;
      }
    }

    const pts: L.LatLng[] = [];
    pts.push(startPoint);

    if (!this.almostSame(startPoint, startNodeCoords)) pts.push(startNodeCoords);

    for (const p of mainRoutePoints) {
      if (pts.length === 0 || !this.almostSame(pts[pts.length - 1], p)) pts.push(p);
    }

    if (!this.almostSame(pts[pts.length - 1], endPoint)) pts.push(endPoint);

    this.currentRoutePoints = pts;

    if (startPoint.distanceTo(startNodeCoords) > 1) {
      this.approachPolyline = L.polyline([startPoint, startNodeCoords], {
        color: '#666666',
        weight: 3,
        opacity: 0.7,
        dashArray: '4 8',
      }).addTo(this.map);
    }

    if (pts.length >= 3) {
      const solidPts = pts.slice(0, -1);
      this.currentPolyline = L.polyline(solidPts, {
        color: '#007bff',
        weight: 6,
        opacity: 0.9,
      }).addTo(this.map);

      this.drawEndApproach(pts[pts.length - 2], pts[pts.length - 1]);
    } else if (pts.length === 2) {
      // only dashed segment
      this.drawEndApproach(pts[0], pts[1]);
    }

    const bounds = L.latLngBounds(pts);
    this.lastRouteBounds = bounds;

    if (opts?.fit !== false) {
      this.map.fitBounds(bounds, {
        paddingTopLeft: [30, 140],
        paddingBottomRight: [30, 260],
        maxZoom: 18,
        animate: true,
        duration: 0.7,
      });
    }

    const totalMeters = this.getCurrentRouteDistanceMeters();
    this.routeProgress.emit({
      passedMeters: 0,
      remainingMeters: totalMeters,
      totalMeters,
      progress: 0,
    });
  }

  public fitRouteToView(opts?: {
    paddingTopLeft?: [number, number];
    paddingBottomRight?: [number, number];
    maxZoom?: number;
    animate?: boolean;
  }): boolean {
    if (!this.map) return false;

    let b = this.lastRouteBounds;
    if (!b && this.currentRoutePoints?.length >= 2) {
      b = L.latLngBounds(this.currentRoutePoints);
    }
    if (!b) return false;

    this.map.fitBounds(b, {
      paddingTopLeft: opts?.paddingTopLeft ?? [30, 140],
      paddingBottomRight: opts?.paddingBottomRight ?? [30, 260],
      maxZoom: opts?.maxZoom ?? 18,
      animate: opts?.animate ?? true,
      duration: 0.7,
    } as any);

    return true;
  }

  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]) {
    if (!this.map) return;

    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }

    if (passedPoints && passedPoints.length >= 2) {
      if (!this.passedPolyline) {
        this.passedPolyline = L.polyline(passedPoints, { color: '#777777', weight: 4, opacity: 0.4 }).addTo(this.map);
      } else {
        this.passedPolyline.setLatLngs(passedPoints);
      }
    }

    if (remainingPoints && remainingPoints.length >= 2) {
      const n = remainingPoints.length;
      const a = remainingPoints[n - 2];
      const b = remainingPoints[n - 1];

      if (n >= 3) {
        const solid = remainingPoints.slice(0, -1);

        if (!this.currentPolyline) {
          this.currentPolyline = L.polyline(solid, { color: '#007bff', weight: 6, opacity: 0.9 }).addTo(this.map);
        } else {
          this.currentPolyline.setLatLngs(solid);
        }
      } else {
        if (this.currentPolyline) {
          this.map.removeLayer(this.currentPolyline);
          this.currentPolyline = null;
        }
      }

      this.drawEndApproach(a, b);
    } else {
      if (this.currentPolyline) {
        this.map.removeLayer(this.currentPolyline);
        this.currentPolyline = null;
      }
      if (this.endApproachPolyline) {
        this.map.removeLayer(this.endApproachPolyline);
        this.endApproachPolyline = null;
      }
    }

    const passedMeters = this.sumDistanceMeters(passedPoints);
    const remainingMeters = this.sumDistanceMeters(remainingPoints);
    const totalMeters = passedMeters + remainingMeters;
    const progress = totalMeters > 0 ? passedMeters / totalMeters : 0;

    this.routeProgress.emit({ passedMeters, remainingMeters, totalMeters, progress });
  }

  public removeRouting(keepDestinationPin: boolean = false) {
    if (!this.map) return;

    if (this.currentPolyline) {
      this.map.removeLayer(this.currentPolyline);
      this.currentPolyline = null;
    }
    if (this.passedPolyline) {
      this.map.removeLayer(this.passedPolyline);
      this.passedPolyline = null;
    }
    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }
    if (this.endApproachPolyline) {
      this.map.removeLayer(this.endApproachPolyline);
      this.endApproachPolyline = null;
    }

    if (!keepDestinationPin) {
      if (this.destinationMarker) {
        this.map.removeLayer(this.destinationMarker);
        this.destinationMarker = null;
      }
    }

    this.routingService.removeRouting(this.map);
    this.currentRoutePoints = [];

    this.snapEngaged = false;
    this.lastSnapLL = null;

    this.routeProgress.emit({ passedMeters: 0, remainingMeters: 0, totalMeters: 0, progress: 0 });
    this.lastRouteBounds = null;

    // reroute reset
    this.activeDestination = null;
    this.activeEndPoint = null;
    this.rerouteEnabled = false;
    this.offRouteStreak = 0;
    this.lastRerouteAt = 0;

    // ✅ reset arrival trigger
    this.arrivedNearPinTriggered = false;
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.currentRoutePoints;
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  invalidateSizeSafe() {
    try {
      (this as any).map?.invalidateSize(true);
    } catch {}
  }

  async refreshBaseLayer() {
    try {
      const map = (this as any).map;
      const baseLayer = (this as any).baseLayer;

      if (!map) return;

      if (baseLayer && typeof baseLayer.redraw === 'function') {
        baseLayer.redraw();
        return;
      }

      if (baseLayer && map.hasLayer(baseLayer)) {
        map.removeLayer(baseLayer);
        baseLayer.addTo(map);
      }
    } catch {}
  }
}
