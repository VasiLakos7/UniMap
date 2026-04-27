import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';

import { Destination, destinationList } from '../models/destination.model';
import { GpsService } from './gps.service';
import { RouteService } from './route.service';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: L.Map;
  private userMarker!: L.Marker;

  private baseLayer?: L.TileLayer;
  private mapTilerKey: string | null = null;

  // ── Camera follow ──────────────────────────────────────────────────────────
  private followUser    = false;
  private followZoom: number | null = null;
  private lastUserLatLng: L.LatLng | null = null;
  private autoRecenterTimer: any = null;
  private autoRecenterMs = 5000;   // 5s; 2.5s during navigation

  // ── Free-pan mode: user dragged during navigation ──────────────────────────
  private isFreePanning    = false;
  private cameraUpdating   = false;  // true only while updateCamera calls setView
  // Set when user manually pans during navigation; cleared only by recenterToUser().
  private userPannedInNav  = false;

  // ── Navigation camera (heading-up) ─────────────────────────────────────────
  private navCameraActive = false;

  // ── Marker animation + dead-reckoning ──────────────────────────────────────
  private animReq:  number | null = null;
  private animFrom: L.LatLng | null = null;
  private animTo:   L.LatLng | null = null;   // last GPS position (null = no fix yet)
  private animStart     = 0;
  private lastFixAt     = 0;
  private velLat           = 0;   // GPS-to-GPS velocity deg/ms (for dead-reckoning)
  private velLng           = 0;
  private velSpeedDegMs    = 0;   // speed magnitude in isotropic deg/ms
  private liveHeadingDeg: number | null = null; // live compass, updated every ~80ms
  private extrapolating    = false;

  // ── Debug values (read by home.page.ts) ────────────────────────────────────
  public dbgFixDtMs   = 0;   // ms between last two GPS fixes
  public dbgFixDistM  = 0;   // metres between last two GPS positions
  public dbgExtrap    = false; // true while dead-reckoning
  private readonly EXTRAP_MAX_MS = 1500;  // max dead-reckoning time (GPS now ~1s, 1.5 cycles)

  // ── Map bearing & two-finger rotation ──────────────────────────────────────
  private mapBearingDeg     = 0;
  private rotTouchPrevAngle: number | null = null;
  private rotAnimReq:        number | null = null;

  // ── User marker icons ──────────────────────────────────────────────────────
  private readonly userArrowIcon = L.divIcon({
    className: 'user-marker',
    html: `<img class="user-arrow" src="assets/images/pins/arrow.png" />`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  private readonly userDotIcon = L.divIcon({
    className: 'user-dot',
    html: `<span class="dot" aria-hidden="true"></span><span class="halo" aria-hidden="true"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
  private activeUserStyle: 'arrow' | 'dot' = 'dot';

  // ── Building labels ────────────────────────────────────────────────────────
  private buildingLabelMarkers: Array<{ marker: L.Marker; dest: Destination }> = [];

  // ── Tile loading ───────────────────────────────────────────────────────────
  public mapLoadingProgress = new EventEmitter<{ loading: boolean; progress: number }>();
  public firstTilesLoaded   = new EventEmitter<void>();
  public tileLoadFailed     = new EventEmitter<void>();
  private isMapLoading        = false;
  private tileInflight        = 0;
  private tileLoaded          = 0;
  private tileErrorCount      = 0;
  private bootLoadSessionActive = false;
  private readonly BOOT_OVERLAY_MIN_MS = 650;
  private bootLoadingStartedAt = 0;
  private bootOffTimer:    any = null;
  private bootFailsafeTimer: any = null;
  private firstTilesLoadedFired = false;

  // ── Map click ──────────────────────────────────────────────────────────────
  public mapClicked          = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public outsideCampusClick  = new EventEmitter<void>();

  // ── Campus boundary ────────────────────────────────────────────────────────
  private campusBoundary = L.polygon([
    [40.659484, 22.801706],
    [40.659338, 22.806507],
    [40.654901, 22.806625],
    [40.6555,   22.80184 ],
  ]);

  private destinationList = destinationList;

  constructor(
    private gpsSvc: GpsService,
    private routeSvc: RouteService,
    private translate: TranslateService,
  ) {
    this.translate.onLangChange.subscribe(() => this.refreshBuildingLabelTexts());
  }

  // ── Forwarded events ───────────────────────────────────────────────────────
  get locationFound()  { return this.gpsSvc.locationFound; }
  get locationError()  { return this.gpsSvc.locationError; }
  get gpsStale()       { return this.gpsSvc.gpsStale; }
  get routeProgress()  { return this.routeSvc.routeProgress; }
  get arrivedNearPin() { return this.routeSvc.arrivedNearPin; }
  get rerouteOffline() { return this.routeSvc.rerouteOffline; }
  get onReroute()      { return this.routeSvc.onReroute; }

  public isGpsWatching(): boolean { return this.gpsSvc.isWatching(); }

  // ── Map init ───────────────────────────────────────────────────────────────

  initializeMap(elementId: string): void {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }

    this.resetAnimState();

    this.firstTilesLoadedFired = false;
    this.bootLoadSessionActive = true;
    this.bootLoadingStartedAt  = 0;

    if (this.bootOffTimer) { clearTimeout(this.bootOffTimer); this.bootOffTimer = null; }
    this.setMapLoading(true, 2);

    if (this.bootFailsafeTimer) clearTimeout(this.bootFailsafeTimer);
    this.bootFailsafeTimer = setTimeout(() => {
      if (this.bootLoadSessionActive) {
        this.tileInflight = 0;
        this.setMapLoading(false, 100);
        this.bootLoadSessionActive = false;
      }
    }, 12000);

    // No setView here — the first view is set by showUserAt once GPS arrives,
    // so tiles only load for the user's real position (no wasted campus-center load).
    this.map = L.map(elementId, {
      zoomControl: false,
      keyboard:    true,
      maxZoom:     22,
      zoomSnap:    0.5,
      zoomDelta:   0.5,
      renderer: L.svg({ padding: 1.0 }),
    });

    this.mapTilerKey = 'fFUNZQgQLPQX2iZWUJ8w';
    this.setBaseLayer('maptiler-osm', this.mapTilerKey);

    this.setUserMarkerStyle(this.activeUserStyle);

    this.setupMapClickEvent();
    this.setupFreePanHandlers();
    this.setupRotationGesture();

    this.routeSvc.registerMap(this.map);
    this.gpsSvc.registerCallbacks(
      (lt, ln)        => this.updateUserPosition(lt, ln),
      (deg)           => this.applyHeading(deg),
      (lt, ln, zoom)  => {
        try {
          this.setFollowUser(true, zoom);
          this.map.setView([lt, ln], zoom, { animate: true });
        } catch {}
      },
      ()              => this.activeUserStyle === 'arrow'
    );

    this.addBuildingLabels();
  }

  // ── Animation state reset ──────────────────────────────────────────────────

  private resetAnimState(): void {
    if (this.animReq) { cancelAnimationFrame(this.animReq); this.animReq = null; }
    this.animFrom      = null;
    this.animTo        = null;
    this.animStart     = 0;
    this.lastFixAt     = 0;
    this.velLat        = 0;
    this.velLng        = 0;
    this.extrapolating = false;
    this.lastUserLatLng = null;
  }

  // ── Tile loading ───────────────────────────────────────────────────────────

  public getMapLoading(): boolean { return this.isMapLoading; }

  private setMapLoading(loading: boolean, progress: number): void {
    const p = Math.max(0, Math.min(100, Math.round(progress)));

    if (loading) {
      if (!this.isMapLoading) this.bootLoadingStartedAt = Date.now();
      if (this.bootOffTimer) { clearTimeout(this.bootOffTimer); this.bootOffTimer = null; }
      this.isMapLoading = true;
      this.mapLoadingProgress.emit({ loading: true, progress: p });
      return;
    }

    const shouldHold = this.bootLoadSessionActive && this.bootLoadingStartedAt > 0;
    if (shouldHold) {
      const wait = this.BOOT_OVERLAY_MIN_MS - (Date.now() - this.bootLoadingStartedAt);
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

    if (this.bootOffTimer) { clearTimeout(this.bootOffTimer); this.bootOffTimer = null; }
    this.isMapLoading = false;
    this.mapLoadingProgress.emit({ loading: false, progress: 100 });
  }

  private hookFirstTilesLoaded(layer?: L.TileLayer): void {
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
        clearTimeout(t); sub.unsubscribe(); resolve(true);
      });
    });
  }

  private hookTileLoadingProgress(layer?: L.TileLayer): void {
    if (!layer) return;

    this.tileInflight  = 0;
    this.tileLoaded    = 0;
    this.tileErrorCount = 0;

    const emit = () => {
      if (!this.bootLoadSessionActive) return;
      const denom = this.tileLoaded + this.tileInflight;
      const ratio = denom > 0 ? this.tileLoaded / denom : 0;
      const prog  = this.isMapLoading ? Math.max(2, Math.round(ratio * 100)) : 100;
      this.setMapLoading(this.isMapLoading, prog);
    };

    layer.on('loading', () => {
      if (!this.bootLoadSessionActive) return;
      this.tileInflight = 0; this.tileLoaded = 0; this.tileErrorCount = 0;
      this.setMapLoading(true, 2);
    });
    layer.on('tileloadstart', () => { if (!this.bootLoadSessionActive) return; this.tileInflight++; emit(); });

    const onTileDone = () => {
      if (!this.bootLoadSessionActive) return;
      this.tileInflight = Math.max(0, this.tileInflight - 1);
      this.tileLoaded++;
      emit();
    };

    layer.on('tileload',  onTileDone);
    layer.on('tileerror', () => { this.tileErrorCount++; onTileDone(); });
    layer.on('load', () => {
      if (!this.bootLoadSessionActive) return;
      this.tileInflight = 0;
      this.setMapLoading(false, 100);
      const total = this.tileLoaded;
      if (total >= 4 && this.tileErrorCount / total > 0.4) {
        setTimeout(() => this.tileLoadFailed.emit(), 800);
      }
      if (this.bootFailsafeTimer) { clearTimeout(this.bootFailsafeTimer); this.bootFailsafeTimer = null; }
      setTimeout(() => { this.bootLoadSessionActive = false; }, 150);
    });
  }

  // ── User marker ────────────────────────────────────────────────────────────

  private setupUserMarker(lat: number, lng: number): void {
    if (!this.map) return;
    if (this.userMarker) { this.userMarker.setLatLng([lat, lng]); return; }
    this.userMarker = L.marker([lat, lng], {
      icon: this.activeUserStyle === 'arrow' ? this.userArrowIcon : this.userDotIcon,
    }).addTo(this.map);
  }

  public showUserAt(lat: number, lng: number): void {
    try { this.map.setView([lat, lng], 18, { animate: false }); } catch {}
    this.setupUserMarker(lat, lng);
    const ll = L.latLng(lat, lng);
    this.lastUserLatLng = ll;
    this.animateMarkerTo(ll);
  }

  private updateUserPosition(lat: number, lng: number): void {
    const ll = L.latLng(lat, lng);
    this.lastUserLatLng = ll;
    this.setupUserMarker(lat, lng);
    this.animateMarkerTo(ll);
  }

  // ── Marker animation ───────────────────────────────────────────────────────
  //
  // ── Marker animation + dead-reckoning (Google-Maps style) ─────────────────
  //
  // GPS fires ~1 Hz on Android. This can't be changed — it's hardware.
  // To feel real-time we do two things at 60 fps:
  //
  //  Phase 1 — Snap (SNAP_DUR_MS ≈ 250 ms):
  //    Ease marker from its current position to the new GPS position.
  //    Short so the marker reaches truth quickly.
  //
  //  Phase 2 — Dead-reckoning (up to EXTRAP_MAX_MS):
  //    Continue at the GPS-to-GPS velocity so the marker keeps moving
  //    forward. Velocity = (new GPS pos − last GPS pos) / GPS interval.
  //    When the next fix arrives, cancel rAF and restart from Phase 1.
  //
  // Result: marker is always moving at 60 fps, never parks between fixes.

  private animateMarkerTo(next: L.LatLng): void {
    if (!this.userMarker) return;

    // First fix — place marker immediately, nothing to animate
    if (!this.animTo) {
      this.userMarker.setLatLng(next);
      this.animTo        = next;
      this.animFrom      = next;
      this.lastFixAt     = performance.now();
      this.updateCamera(next);
      return;
    }

    const now = performance.now();
    const dt  = now - this.lastFixAt;
    this.lastFixAt = now;

    const from  = this.userMarker.getLatLng();
    const distM = this.animTo ? this.animTo.distanceTo(next) : from.distanceTo(next);

    // Debug
    this.dbgFixDtMs  = Math.round(dt);
    this.dbgFixDistM = Math.round(distM * 10) / 10;

    if (this.animReq) { cancelAnimationFrame(this.animReq); this.animReq = null; }

    // Teleport (GPS glitch / exit from building)
    if (distM > 30) {
      this.userMarker.setLatLng(next);
      this.animFrom      = next;
      this.animTo        = next;
      this.velLat        = 0;
      this.velLng        = 0;
      this.extrapolating = false;
      this.updateCamera(next);
      return;
    }

    // GPS-to-GPS velocity — real walking speed regardless of where the
    // animated marker happens to be right now.
    // Zero out velocity when nearly stationary: GPS jitter (~1-4m) would otherwise
    // cause dead-reckoning to extrapolate in a random direction, creating trembling.
    const dtSafe  = Math.max(500, dt);
    if (distM < 3) {
      this.velLat        = 0;
      this.velLng        = 0;
      this.velSpeedDegMs = 0;
    } else {
      this.velLat   = (next.lat - this.animTo.lat) / dtSafe;
      this.velLng   = (next.lng - this.animTo.lng) / dtSafe;
      // Isotropic speed magnitude (deg/ms) used when compass redirects DR direction.
      const cosLat  = Math.cos(next.lat * Math.PI / 180);
      this.velSpeedDegMs = Math.sqrt(
        this.velLat * this.velLat + (this.velLng * cosLat) * (this.velLng * cosLat)
      );
    }

    this.animTo        = next;
    this.animFrom      = from;
    this.animStart     = now;
    this.extrapolating = false;

    // Dynamic snap: proportional to how far marker is from new GPS fix.
    // Small error (good dead-reckoning) → fast snap. Large error (turn/stop) → smoother.
    const markerErrM = from.distanceTo(next);
    const snapDur    = Math.max(100, Math.min(320, markerErrM * 160));
    const dLat       = next.lat - from.lat;
    const dLng       = next.lng - from.lng;

    const step = (t: number) => {
      if (!this.animFrom || !this.animTo) return;

      const elapsed = t - this.animStart;
      let lat: number, lng: number;

      if (elapsed < snapDur) {
        // ── Phase 1: ease to GPS position ──────────────────────────────
        const k  = elapsed / snapDur;
        const ek = 1 - (1 - k) * (1 - k);   // ease-out quad
        lat = this.animFrom.lat + dLat * ek;
        lng = this.animFrom.lng + dLng * ek;

      } else {
        // ── Phase 2: dead-reckon ahead at GPS velocity ──────────────────
        if (!this.extrapolating) {
          this.extrapolating  = true;
          this.dbgExtrap      = true;
        }
        const over = elapsed - snapDur;
        if (over >= this.EXTRAP_MAX_MS) {
          // GPS stopped / user standing still — park at last known position
          this.extrapolating = false;
          this.dbgExtrap     = false;
          this.userMarker.setLatLng(this.animTo);
          this.updateCamera(this.animTo);
          this.animReq = null;
          return;
        }
        // Use live compass heading to redirect dead-reckoning when user turns.
        // Speed stays GPS-derived; only direction follows the compass.
        if (this.liveHeadingDeg !== null && this.velSpeedDegMs > 1e-8) {
          const hRad   = this.liveHeadingDeg * Math.PI / 180;
          const cosLat = Math.cos((this.animTo?.lat ?? 0) * Math.PI / 180);
          lat = this.animTo.lat + this.velSpeedDegMs * Math.cos(hRad) * over;
          lng = this.animTo.lng + this.velSpeedDegMs * Math.sin(hRad) / cosLat * over;
        } else {
          lat = this.animTo.lat + this.velLat * over;
          lng = this.animTo.lng + this.velLng * over;
        }
      }

      const cur = L.latLng(lat, lng);
      this.userMarker.setLatLng(cur);
      this.updateCamera(cur);

      if (elapsed < snapDur || this.extrapolating) {
        this.animReq = requestAnimationFrame(step);
      } else {
        this.animReq = null;
      }
    };

    this.animReq = requestAnimationFrame(step);
  }

  // ── Camera follow ──────────────────────────────────────────────────────────
  // Called every rAF frame (~60 fps) while animating. No distance threshold —
  // calling setView at 60 fps with animate:false is how smooth map panning
  // works (Leaflet uses CSS transforms internally, it's GPU-accelerated).

  private updateCamera(cur: L.LatLng): void {
    if (!this.map || !this.followUser || this.userPannedInNav) return;
    const zoom = this.followZoom ?? this.map.getZoom();
    this.cameraUpdating = true;
    this.map.setView(cur, zoom, { animate: false });
    this.cameraUpdating = false;
  }

  // ── Heading ────────────────────────────────────────────────────────────────

  private applyHeading(deg: number): void {
    this.liveHeadingDeg = deg;   // keep live compass for dead-reckoning direction
    if (!this.userMarker) return;
    const el  = this.userMarker.getElement();
    if (!el) return;
    const img = el.querySelector('img.user-arrow') as HTMLImageElement | null;
    if (img) {
      img.style.transformOrigin = '50% 50%';
      img.style.transform = `rotate(${deg}deg)`;
    }
  }

  /** Counter-rotate destination pins so they stay upright when the map container
   *  is CSS-rotated (heading-up mode). Pivot = bottom-center (pin anchor). */
  private counterRotateMarkers(deg: number): void {
    if (!this.map) return;
    const icons = this.map.getContainer().querySelectorAll<HTMLElement>(
      '.leaflet-marker-icon:not(.user-marker):not(.user-dot):not(.building-label-icon)'
    );
    icons.forEach(el => {
      el.style.transformOrigin = '50% 100%';
      el.style.transform = `rotate(${deg}deg)`;
    });
  }

  public setUserHeading(deg: number): void { this.gpsSvc.setUserHeading(deg); }

  public setUserMarkerStyle(style: 'arrow' | 'dot'): void {
    this.activeUserStyle = style;
    if (!this.userMarker) return;
    this.userMarker.setIcon(style === 'arrow' ? this.userArrowIcon : this.userDotIcon);
    if (this.gpsSvc.lastHeadingDeg != null) {
      setTimeout(() => this.applyHeading(this.gpsSvc.lastHeadingDeg!), 0);
    }
  }

  // ── Navigation mode ────────────────────────────────────────────────────────

  public setNavigationMode(active: boolean): void {
    this.setUserMarkerStyle(active ? 'arrow' : 'dot');
    this.routeSvc.setMapMatchEnabled(active);
    this.navCameraActive = active;
    this.autoRecenterMs  = active ? 2500 : 5000;
    if (!active) { this.userPannedInNav = false; this.resetMapRotation(); }
    if (active)  { this.gpsSvc.reprocessLastFix(); }
  }

  get isFollowingUser(): boolean { return this.followUser && !this.isFreePanning; }

  private resetMapRotation(): void {
    if (!this.map) return;
    this.mapBearingDeg = 0;
    if (this.rotAnimReq) { cancelAnimationFrame(this.rotAnimReq); this.rotAnimReq = null; }
    const container = this.map.getContainer();
    container.style.transform       = '';
    container.style.transformOrigin = '';
    container.querySelectorAll<HTMLElement>(
      '.leaflet-marker-icon:not(.user-marker):not(.user-dot):not(.building-label-icon)'
    ).forEach(el => { el.style.transform = ''; el.style.transformOrigin = ''; });
  }

  public setNorthLock(_enabled: boolean): void {}  // stub for future implementation

  // ── Camera / follow public API ─────────────────────────────────────────────

  public setFollowUser(enabled: boolean, zoom?: number): void {
    this.followUser  = enabled;
    this.followZoom  = typeof zoom === 'number' ? zoom : null;
    if (enabled) { this.isFreePanning = false; }
  }

  public recenterToUser(opts?: { zoom?: number; animate?: boolean; follow?: boolean }): boolean {
    if (!this.map || !this.lastUserLatLng) return false;
    const zoom    = opts?.zoom    ?? Math.max(this.map.getZoom(), 18);
    const animate = opts?.animate ?? true;
    this.userPannedInNav = false;
    this.map.setView(this.lastUserLatLng, zoom, { animate });
    if (opts?.follow) this.setFollowUser(true, zoom);
    return true;
  }

  public focusOn(lat: number, lng: number, zoom = 19): void {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  // ── Base layer ─────────────────────────────────────────────────────────────

  private setBaseLayer(
    style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm' | 'maptiler-basic' | 'cartodb-nolabels',
    apiKey?: string
  ): void {
    if (!this.map) return;
    if (this.baseLayer) this.map.removeLayer(this.baseLayer);

    const common: L.TileLayerOptions = { maxZoom: 22, maxNativeZoom: 19, keepBuffer: 6 };
    const layers: Record<string, { url: string; opt: L.TileLayerOptions }> = {
      osm: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opt: { attribution: '© OpenStreetMap contributors', ...common },
      },
      positron: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO', ...common },
      },
      dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO', ...common },
      },
      'cartodb-nolabels': {
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO', ...common },
      },
      'maptiler-outdoor': {
        url: `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: { attribution: '© OpenStreetMap | © MapTiler', tileSize: 512, zoomOffset: -1, ...common },
      },
      'maptiler-osm': {
        url: `https://api.maptiler.com/maps/openstreetmap/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: { attribution: '© OpenStreetMap | © MapTiler', tileSize: 512, zoomOffset: -1, ...common },
      },
      'maptiler-basic': {
        url: `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: { attribution: '© OpenStreetMap | © MapTiler', tileSize: 512, zoomOffset: -1, ...common },
      },
    };

    this.baseLayer = L.tileLayer(layers[style].url, layers[style].opt).addTo(this.map);
    this.hookFirstTilesLoaded(this.baseLayer);
    this.hookTileLoadingProgress(this.baseLayer);
    if (this.bootLoadSessionActive) this.setMapLoading(true, 2);
  }

  public setBaseLayerFromSettings(mode: string): void {
    const map: Record<string, string> = {
      osm: 'osm', positron: 'positron', dark: 'dark',
      'maptiler-outdoor': 'maptiler-outdoor',
      'maptiler-osm': 'maptiler-osm', maptiler: 'maptiler-osm',
      'maptiler-basic': 'maptiler-basic',
      cartodb: 'cartodb-nolabels',
    };
    const style = (map[mode] ?? 'maptiler-basic') as Parameters<typeof this.setBaseLayer>[0];
    const needsKey = style === 'maptiler-outdoor' || style === 'maptiler-osm' || style === 'maptiler-basic';
    this.setBaseLayer(style, needsKey ? this.mapTilerKey ?? undefined : undefined);
    this.refreshMap();
  }

  public refreshMap(): void {
    if (!this.map) return;
    setTimeout(() => { this.map.invalidateSize(true); try { this.baseLayer?.redraw?.(); } catch {} }, 60);
  }

  invalidateSizeSafe(): void { try { (this as any).map?.invalidateSize(true); } catch {} }

  async refreshBaseLayer(): Promise<void> {
    try {
      const map = (this as any).map as L.Map | undefined;
      const bl  = (this as any).baseLayer as L.TileLayer | undefined;
      if (!map || !bl) return;
      if (typeof bl.redraw === 'function') { bl.redraw(); return; }
      if (map.hasLayer(bl)) { map.removeLayer(bl); bl.addTo(map); }
    } catch {}
  }

  // ── Campus boundary ────────────────────────────────────────────────────────

  private isInsideCampus(lat: number, lng: number): boolean {
    const polygon = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    const x = lng; const y = lat;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  public isPointInsideCampusLoose(lat: number, lng: number, marginM = 45): boolean {
    if (this.isInsideCampus(lat, lng)) return true;
    const ring = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    if (!ring || ring.length < 3) return false;
    const P = L.CRS.EPSG3857.project(L.latLng(lat, lng));
    let minDist = Infinity;
    const ptSegDist = (p: L.Point, a: L.Point, b: L.Point) => {
      const abx = b.x - a.x, aby = b.y - a.y;
      const ab2 = abx * abx + aby * aby;
      if (ab2 <= 1e-7) { const dx = p.x-a.x, dy = p.y-a.y; return Math.sqrt(dx*dx+dy*dy); }
      const t  = Math.max(0, Math.min(1, ((p.x-a.x)*abx + (p.y-a.y)*aby) / ab2));
      const cx = a.x + t*abx, cy = a.y + t*aby;
      const dx = p.x-cx, dy = p.y-cy;
      return Math.sqrt(dx*dx + dy*dy);
    };
    for (let i = 0; i < ring.length; i++) {
      const A = L.CRS.EPSG3857.project(ring[i]);
      const B = L.CRS.EPSG3857.project(ring[(i+1) % ring.length]);
      const d = ptSegDist(P, A, B);
      if (d < minDist) minDist = d;
    }
    return minDist <= marginM;
  }

  public isPointInsideCampus(lat: number, lng: number): boolean {
    return this.isInsideCampus(lat, lng);
  }

  // ── Map click handler ──────────────────────────────────────────────────────

  private setupMapClickEvent(): void {
    if (!this.map) return;
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.isMapLoading) return;
      const { lat, lng } = e.latlng;
      if (!this.isInsideCampus(lat, lng)) {
        if (!this.isPointInsideCampusLoose(lat, lng, 45)) this.outsideCampusClick.emit();
        return;
      }
      let found = this.destinationList.find((d: Destination) => {
        const b = d.bounds;
        return b && lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
      });
      if (!found) found = this.routeSvc.findNearestDestinationWithin(lat, lng, 30, 'center');
      this.mapClicked.emit({ lat, lng, name: found ? found.name : null });
    });
  }

  // ── Map bearing helpers ────────────────────────────────────────────────────

  private normalizeAngleDeg(deg: number): number {
    const d = ((deg % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
  }

  private applyMapRotationNow(): void {
    if (!this.map) return;
    const container = this.map.getContainer();
    container.style.transformOrigin = '50% 50%';
    container.style.transform       = `rotate(${-this.mapBearingDeg}deg)`;
    this.counterRotateMarkers(this.mapBearingDeg);
  }

  private setupRotationGesture(): void {
    if (!this.map) return;
    const el = this.map.getContainer();

    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 2) this.rotTouchPrevAngle = this.getTwoFingerAngle(e.touches);
    }, { passive: true });

    el.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length !== 2 || this.rotTouchPrevAngle === null) return;
      if (!this.navCameraActive) return;
      const angle = this.getTwoFingerAngle(e.touches);
      this.mapBearingDeg    = this.normalizeAngleDeg(this.mapBearingDeg - (angle - this.rotTouchPrevAngle));
      this.rotTouchPrevAngle = angle;
      this.applyMapRotationNow();
    }, { passive: true });

    el.addEventListener('touchend', () => { this.rotTouchPrevAngle = null; }, { passive: true });
  }

  private getTwoFingerAngle(touches: TouchList): number {
    return Math.atan2(
      touches[1].clientY - touches[0].clientY,
      touches[1].clientX - touches[0].clientX
    ) * (180 / Math.PI);
  }

  // ── Free pan handlers ──────────────────────────────────────────────────────

  private setupFreePanHandlers(): void {
    if (!this.map) return;

    const stopFollow = (_e: any) => {
      if (!this.followUser || this.cameraUpdating) return;
      this.isFreePanning = true;
      this.setFollowUser(false);
      clearTimeout(this.autoRecenterTimer);
    };

    const scheduleResume = () => {
      if (!this.isFreePanning) return;
      // Outside navigation mode, panning permanently stops following — no auto-resume.
      if (!this.navCameraActive) return;
      clearTimeout(this.autoRecenterTimer);
      this.autoRecenterTimer = setTimeout(() => {
        if (!this.isFreePanning) return;
        this.setFollowUser(true, this.followZoom ?? this.map?.getZoom());
      }, this.autoRecenterMs);
    };

    this.map.on('dragstart',  stopFollow);
    this.map.on('zoomstart',  stopFollow);
    this.map.on('movestart',  stopFollow);
    this.map.on('dragend',    scheduleResume);

    // Nav-mode pan detection: independent of stopFollow/followUser state.
    // dragstart fires only for real user drags, never for programmatic setView.
    this.map.on('dragstart', () => {
      if (this.navCameraActive) this.userPannedInNav = true;
    });

    // Correct drag deltas when map container is CSS-rotated (heading-up mode).
    // Leaflet computes deltas in screen-pixel space; we rotate them by the bearing
    // so dragging "up on screen" always pans in the visually-facing direction.
    const draggable = (this.map.dragging as any)?._draggable;
    if (draggable) {
      draggable.on('predrag', () => {
        const bearing = this.mapBearingDeg;
        if (!bearing) return;
        const newPos: L.Point   = draggable._newPos;
        const startPos: L.Point = draggable._startPos;
        const dx  = newPos.x - startPos.x;
        const dy  = newPos.y - startPos.y;
        const rad = (bearing * Math.PI) / 180;
        draggable._newPos = L.point(
          startPos.x + dx * Math.cos(rad) - dy * Math.sin(rad),
          startPos.y + dx * Math.sin(rad) + dy * Math.cos(rad)
        );
      });
    }
  }

  // ── Misc utilities ─────────────────────────────────────────────────────────

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  // ── Pass-throughs to GpsService ────────────────────────────────────────────

  public async requestLocationPermission(): Promise<boolean> { return this.gpsSvc.requestLocationPermission(); }
  public async getInitialPosition(timeoutMs = 15000): Promise<{ lat: number; lng: number } | null> {
    return this.gpsSvc.getInitialPosition(timeoutMs);
  }
  public async startGpsWatch(centerOnFirstFix = true, zoomOnFirstFix = 18): Promise<void> {
    this.resetAnimState();   // clear stale animation from previous session
    return this.gpsSvc.startGpsWatch(centerOnFirstFix, zoomOnFirstFix);
  }
  public async stopGpsWatch(): Promise<void> {
    this.resetAnimState();
    return this.gpsSvc.stopGpsWatch();
  }

  // ── Pass-throughs to RouteService ──────────────────────────────────────────

  public async drawCustomRouteToDestination(
    dest: Destination, startPoint: L.LatLng,
    opts?: { fit?: boolean; wheelchair?: boolean }
  ): Promise<void> {
    return this.routeSvc.drawCustomRouteToDestination(dest, startPoint, opts);
  }
  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]): void {
    this.routeSvc.updateRouteProgress(passedPoints, remainingPoints);
  }
  public removeRouting(keepDestinationPin = false): void { this.routeSvc.removeRouting(keepDestinationPin); }
  public pinDestination(lat: number, lng: number, label?: string): void {
    this.routeSvc.pinDestination(lat, lng, label);
  }
  public pinDestinationByMode(dest: Destination, mode: 'center' | 'entrance' = 'center', label?: string): void {
    this.routeSvc.pinDestinationByMode(dest, mode, label);
  }
  public previewRouteBounds(from: L.LatLng, to: L.LatLng, bottomPad = 280): void {
    if (!this.map) return;
    this.setFollowUser(false);
    this.map.fitBounds(L.latLngBounds([from, to]).pad(0.15), {
      paddingTopLeft:    [30, 140],
      paddingBottomRight: [30, bottomPad],
      maxZoom: 17, animate: true, duration: 0.8,
    } as any);
  }
  public fitRouteToView(opts?: {
    paddingTopLeft?: [number, number]; paddingBottomRight?: [number, number];
    maxZoom?: number; animate?: boolean;
  }): boolean {
    this.setFollowUser(false);
    return this.routeSvc.fitRouteToView(opts);
  }
  public getCurrentRoutePoints(): L.LatLng[]            { return this.routeSvc.getCurrentRoutePoints(); }
  public getCurrentRouteDistanceMeters(): number         { return this.routeSvc.getCurrentRouteDistanceMeters(); }

  // ── Building labels ────────────────────────────────────────────────────────

  private addBuildingLabels(): void {
    if (!this.map) return;
    for (const { marker } of this.buildingLabelMarkers) marker.remove();
    this.buildingLabelMarkers = [];

    for (const dest of destinationList) {
      if (!dest.bounds) continue;
      const marker = L.marker([dest.lat, dest.lng], {
        icon: L.divIcon({
          className: 'building-label-icon',
          html: dest.mapIcon
            ? `<div class="building-label building-label--icon" data-did="${dest.id}">${dest.mapIcon}</div>`
            : `<div class="building-label" data-did="${dest.id}">${this.translate.instant('DEST.' + dest.id + '.NAME')}</div>`,
          iconSize:   [0, 0],
          iconAnchor: [0, 0],
        }),
        interactive:  false,
        keyboard:     false,
        zIndexOffset: -100,
      }).addTo(this.map);
      this.buildingLabelMarkers.push({ marker, dest });
    }

    setTimeout(() => this.updateBuildingLabelSizes(), 0);
    this.map.on('zoomend', () => this.updateBuildingLabelSizes());
  }

  private refreshBuildingLabelTexts(): void {
    for (const { dest } of this.buildingLabelMarkers) {
      if (dest.mapIcon) continue;
      const el = document.querySelector(`.building-label[data-did="${dest.id}"]`) as HTMLElement | null;
      if (!el) continue;
      el.textContent = this.translate.instant(`DEST.${dest.id}.NAME`);
    }
  }

  private updateBuildingLabelSizes(): void {
    if (!this.map) return;
    const show = this.map.getZoom() >= 17;
    for (const { dest } of this.buildingLabelMarkers) {
      const el = document.querySelector(`.building-label[data-did="${dest.id}"]`) as HTMLElement | null;
      if (!el) continue;
      if (!show || !dest.bounds) { el.style.display = 'none'; continue; }
      el.style.display   = '';
      const scale = Math.max(0.4, Math.min(1.0, Math.pow(2, this.map.getZoom() - 18)));
      el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    }
  }

}
