import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';

import { Destination, destinationList } from '../models/destination.model';
import { GpsService } from './gps.service';
import { RouteService } from './route.service';

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: L.Map;
  private userMarker!: L.Marker;

  private baseLayer?: L.TileLayer;
  private mapTilerKey: string | null = null;

  // Camera follow
  private followUser = false;
  private followZoom: number | null = null;
  private lastUserLatLng: L.LatLng | null = null;
  private lastCamMoveAt = 0;
  private lastCamLL: L.LatLng | null = null;
  private readonly CAM_MIN_INTERVAL_MS = 250;
  private readonly CAM_MIN_MOVE_M = 1;

  // Navigation camera (heading-up + offset)
  private navCameraActive = false;
  private readonly NAV_CAM_OFFSET_RATIO = 0.18; // user at ~68% from top

  // Animation
  private animReq: number | null = null;
  private animFrom: L.LatLng | null = null;
  private animTo: L.LatLng | null = null;
  private animStart = 0;
  private lastFixAt = 0;
  // Velocity extrapolation (dead-reckoning between GPS fixes)
  private velLat = 0;   // deg/ms
  private velLng = 0;
  private extrapolating = false;
  private readonly EXTRAP_MAX_MS = 2000; // stop dead-reckoning after this

  // Map bearing & manual rotation (nav mode)
  private mapBearingDeg = 0;          // compass direction currently at top of screen
  private gpsHeadingDeg_ = 0;         // latest GPS heading
  private lastManualRotateAt = 0;
  private rotTouchPrevAngle: number | null = null;
  private rotAnimReq: number | null = null;
  private readonly MANUAL_LOCK_MS = 5000;  // manual override duration
  private readonly AUTO_ROTATE_DEG = 40;   // deviation threshold for auto-correct

  // User marker style
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

  // Tile loading
  public mapLoadingProgress = new EventEmitter<{ loading: boolean; progress: number }>();
  public firstTilesLoaded = new EventEmitter<void>();
  private isMapLoading = false;
  private tileInflight = 0;
  private tileLoaded = 0;
  private bootLoadSessionActive = false;
  private readonly BOOT_OVERLAY_MIN_MS = 650;
  private bootLoadingStartedAt = 0;
  private bootOffTimer: any = null;
  private bootFailsafeTimer: any = null;
  private firstTilesLoadedFired = false;

  // Map click / outside campus
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public outsideCampusClick = new EventEmitter<void>();

  // Campus boundary polygon
  private campusBoundary = L.polygon([
    [40.659484, 22.801706],
    [40.659338, 22.806507],
    [40.654901, 22.806625],
    [40.6555, 22.80184],
  ]);

  private destinationList = destinationList;

  constructor(private gpsSvc: GpsService, private routeSvc: RouteService) {}

  get locationFound() { return this.gpsSvc.locationFound; }
  get locationError()  { return this.gpsSvc.locationError; }
  get routeProgress()  { return this.routeSvc.routeProgress; }
  get arrivedNearPin() { return this.routeSvc.arrivedNearPin; }

  // Map init
  initializeMap(lat: number, lng: number, elementId: string): void {
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
    this.setBaseLayer('maptiler-osm', this.mapTilerKey);

    this.setUserMarkerStyle(this.activeUserStyle);
    this.setupUserMarker(lat, lng);
    this.updateUserPosition(lat, lng);

    this.setupMapClickEvent();
    this.setupFreePanHandlers();
    this.setupRotationGesture();

    // Wire up child services
    this.routeSvc.registerMap(this.map);
    this.gpsSvc.registerCallbacks(
      (lt, ln) => this.updateUserPosition(lt, ln),
      (deg) => this.applyHeading(deg),
      (lt, ln, zoom) => { try { this.map.setView([lt, ln], zoom, { animate: true }); } catch {} },
      () => this.activeUserStyle === 'arrow'
    );
  }

  // Tile loading
  public getMapLoading(): boolean {
    return this.isMapLoading;
  }

  private setMapLoading(loading: boolean, progress: number): void {
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
        clearTimeout(t);
        sub.unsubscribe();
        resolve(true);
      });
    });
  }

  private hookTileLoadingProgress(layer?: L.TileLayer): void {
    if (!layer) return;

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

  // User marker + animation
  private setupUserMarker(lat: number, lng: number): void {
    if (!this.map) return;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
      return;
    }

    this.userMarker = L.marker([lat, lng], {
      icon: this.activeUserStyle === 'arrow' ? this.userArrowIcon : this.userDotIcon,
    }).addTo(this.map);
  }

  private updateUserPosition(lat: number, lng: number): void {
    const ll = L.latLng(lat, lng);
    this.lastUserLatLng = ll;
    this.animateUserMarkerTo(ll);
  }

  private animateUserMarkerTo(next: L.LatLng): void {
    if (!this.userMarker) return;

    if (!this.animTo) {
      this.userMarker.setLatLng(next);
      this.animTo = next;
      return;
    }

    const now = performance.now();
    const dt = this.lastFixAt ? now - this.lastFixAt : 1000;
    this.lastFixAt = now;

    // Cover ~92% of the GPS interval so the marker never freezes waiting for the next fix
    const durationMs = Math.max(200, Math.min(950, dt * 0.92));

    this.animFrom = this.userMarker.getLatLng();
    this.animTo = next;
    const distM = this.animFrom.distanceTo(next);

    // Only teleport for clearly unrealistic jumps (GPS glitch)
    if (distM > 30) {
      this.extrapolating = false;
      this.velLat = 0;
      this.velLng = 0;
      this.userMarker.setLatLng(next);

      if (this.map && this.followUser) {
        const z = this.followZoom ?? this.map.getZoom();
        this.map.panTo(this.getNavCameraCenter(next), { animate: false });
        if (this.map.getZoom() !== z) this.map.setZoom(z);
      }

      this.animFrom = next;
      this.animTo = next;
      return;
    }

    this.animStart = now;
    this.extrapolating = false;
    if (this.animReq) cancelAnimationFrame(this.animReq);

    const dLat = this.animTo.lat - this.animFrom.lat;
    const dLng = this.animTo.lng - this.animFrom.lng;

    const step = (t: number) => {
      if (!this.animFrom || !this.animTo) return;

      const elapsed = t - this.animStart;
      const k = Math.min(1, elapsed / durationMs);
      // ease-out for natural deceleration
      const ek = 1 - (1 - k) * (1 - k);

      let lat: number;
      let lng: number;

      if (k < 1) {
        lat = this.animFrom.lat + dLat * ek;
        lng = this.animFrom.lng + dLng * ek;
      } else if (this.extrapolating) {
        // Dead-reckoning: keep moving at the last velocity until next GPS fix,
        // but stop after EXTRAP_MAX_MS to avoid drifting when stationary.
        const overshoot = elapsed - durationMs;
        if (overshoot > this.EXTRAP_MAX_MS) {
          this.extrapolating = false;
          lat = this.animTo.lat;
          lng = this.animTo.lng;
        } else {
          lat = this.animTo.lat + this.velLat * overshoot;
          lng = this.animTo.lng + this.velLng * overshoot;
        }
      } else {
        // Animation just finished — record velocity for dead-reckoning
        this.velLat = dLat / durationMs;
        this.velLng = dLng / durationMs;
        this.extrapolating = true;
        lat = this.animTo.lat;
        lng = this.animTo.lng;
      }

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
          this.map.panTo(this.getNavCameraCenter(cur), { animate: false });
          if (this.map.getZoom() !== z) this.map.setZoom(z);
        }
      }

      // Keep rAF alive during animation and dead-reckoning (stops when extrapolating=false)
      if (k < 1 || this.extrapolating) this.animReq = requestAnimationFrame(step);
    };

    this.animReq = requestAnimationFrame(step);
  }

  // Heading
  private applyHeading(deg: number): void {
    if (!this.userMarker) return;
    const el = this.userMarker.getElement();
    if (!el) return;

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

    this.gpsHeadingDeg_ = deg;

    // Heading-up: update map bearing (auto-follow or manual override)
    if (this.navCameraActive && this.map) {
      const manualRecent = Date.now() - this.lastManualRotateAt < this.MANUAL_LOCK_MS;
      if (!manualRecent) {
        // Auto-follow: map bearing tracks GPS heading exactly
        this.mapBearingDeg = deg;
        this.applyMapRotationNow();
      } else {
        // Manual override active — only auto-correct if deviation is too large
        const dev = Math.abs(this.normalizeAngleDeg(deg - this.mapBearingDeg));
        if (dev > this.AUTO_ROTATE_DEG) {
          this.lastManualRotateAt = 0; // end manual lock
          this.animateMapBearingTo(deg);
        }
        // else: keep user's manual rotation
      }
    }
  }

  /** Apply +deg to all Leaflet markers except the user marker, so they stay
   *  upright while the map container is rotated by -deg. Pivot = bottom-center
   *  (the natural anchor of a pin icon). */
  private counterRotateMarkers(deg: number): void {
    if (!this.map) return;
    const container = this.map.getContainer();
    const icons = container.querySelectorAll<HTMLElement>(
      '.leaflet-marker-icon:not(.user-marker):not(.user-dot)'
    );
    icons.forEach(el => {
      el.style.transformOrigin = '50% 100%';
      el.style.transform = `rotate(${deg}deg)`;
    });
  }

  public setUserHeading(deg: number): void {
    this.gpsSvc.setUserHeading(deg);
  }

  public setUserMarkerStyle(style: 'arrow' | 'dot'): void {
    this.activeUserStyle = style;

    if (!this.userMarker) return;
    const icon = style === 'arrow' ? this.userArrowIcon : this.userDotIcon;
    this.userMarker.setIcon(icon);

    if (this.gpsSvc.lastHeadingDeg != null) {
      setTimeout(() => this.applyHeading(this.gpsSvc.lastHeadingDeg!), 0);
    }
  }

  // Navigation mode
  public setNavigationMode(active: boolean): void {
    this.setUserMarkerStyle(active ? 'arrow' : 'dot');
    this.routeSvc.setMapMatchEnabled(active);
    this.navCameraActive = active;
    if (!active) this.resetMapRotation();
  }

  private resetMapRotation(): void {
    if (!this.map) return;
    this.mapBearingDeg = 0;
    this.lastManualRotateAt = 0;
    if (this.rotAnimReq) { cancelAnimationFrame(this.rotAnimReq); this.rotAnimReq = null; }
    const container = this.map.getContainer();
    container.style.transform = '';
    container.style.transformOrigin = '';
    // Reset all marker counter-rotations
    const icons = container.querySelectorAll<HTMLElement>(
      '.leaflet-marker-icon:not(.user-marker):not(.user-dot)'
    );
    icons.forEach(el => {
      el.style.transform = '';
      el.style.transformOrigin = '';
    });
  }

  private getNavCameraCenter(userLL: L.LatLng): L.LatLng {
    if (!this.navCameraActive || !this.map) return userLL;
    const size = this.map.getSize();
    const userPx = this.map.latLngToContainerPoint(userLL);
    const offsetPx = size.y * this.NAV_CAM_OFFSET_RATIO;
    // Shift map center in the heading direction (in Leaflet pixel space) so
    // the user always appears at the bottom-center regardless of heading.
    // sin/cos maps compass bearing → Leaflet x/y axes (x=east, y=north↑ inverted).
    const rad = (this.mapBearingDeg * Math.PI) / 180;
    const camPx = L.point(
      userPx.x + offsetPx * Math.sin(rad),
      userPx.y - offsetPx * Math.cos(rad)
    );
    return this.map.containerPointToLatLng(camPx);
  }

  // North lock stub (future implementation)
  public setNorthLock(_enabled: boolean): void {}

  // Camera / follow
  public setFollowUser(enabled: boolean, zoom?: number): void {
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
    const center = this.getNavCameraCenter(this.lastUserLatLng);

    this.map.setView(center, zoom, { animate });

    if (opts?.follow) {
      this.setFollowUser(true, zoom);
    }

    return true;
  }

  public focusOn(lat: number, lng: number, zoom: number = 19): void {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  // Base layer
  private setBaseLayer(
    style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm',
    apiKey?: string
  ): void {
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

  public setBaseLayerFromSettings(mode: string): void {
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

  public refreshMap(): void {
    if (!this.map) return;
    setTimeout(() => {
      this.map.invalidateSize(true);
      try {
        this.baseLayer?.redraw?.();
      } catch {}
    }, 60);
  }

  invalidateSizeSafe(): void {
    try {
      (this as any).map?.invalidateSize(true);
    } catch {}
  }

  async refreshBaseLayer(): Promise<void> {
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

  // Campus boundary
  private isInsideCampus(lat: number, lng: number): boolean {
    const polygon = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    const x = lng;
    const y = lat;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;

      const intersect =
        (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
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

  // Map click handler
  private setupMapClickEvent(): void {
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
        return (
          clickedLat >= b.south &&
          clickedLat <= b.north &&
          clickedLng >= b.west &&
          clickedLng <= b.east
        );
      });

      if (!found) {
        found = this.routeSvc.findNearestDestinationWithin(clickedLat, clickedLng, 40, 'center');
      }

      this.mapClicked.emit({
        lat: clickedLat,
        lng: clickedLng,
        name: found ? found.name : null,
      });
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
    container.style.transform = `rotate(${-this.mapBearingDeg}deg)`;
    this.counterRotateMarkers(this.mapBearingDeg);
  }

  private animateMapBearingTo(targetDeg: number): void {
    if (this.rotAnimReq) cancelAnimationFrame(this.rotAnimReq);
    const startDeg = this.mapBearingDeg;
    const delta = this.normalizeAngleDeg(targetDeg - startDeg);
    if (Math.abs(delta) < 0.5) {
      this.mapBearingDeg = targetDeg;
      this.applyMapRotationNow();
      return;
    }
    const duration = Math.min(700, Math.abs(delta) * 6); // ~6ms/degree, max 700ms
    const startAt = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - startAt) / duration);
      const ek = 1 - (1 - k) * (1 - k); // ease-out
      this.mapBearingDeg = startDeg + delta * ek;
      this.applyMapRotationNow();
      if (k < 1) {
        this.rotAnimReq = requestAnimationFrame(step);
      } else {
        this.mapBearingDeg = targetDeg;
        this.lastManualRotateAt = 0; // resume auto-follow after animation
        this.applyMapRotationNow();
      }
    };
    this.rotAnimReq = requestAnimationFrame(step);
  }

  /** Detect two-finger rotation gesture and apply it as manual map bearing offset. */
  private setupRotationGesture(): void {
    if (!this.map) return;
    const el = this.map.getContainer();

    el.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 2) {
        this.rotTouchPrevAngle = this.getTwoFingerAngle(e.touches);
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length !== 2 || this.rotTouchPrevAngle === null) return;
      if (!this.navCameraActive) return;
      const angle = this.getTwoFingerAngle(e.touches);
      const delta = angle - this.rotTouchPrevAngle;
      this.rotTouchPrevAngle = angle;
      this.mapBearingDeg = this.normalizeAngleDeg(this.mapBearingDeg - delta);
      this.lastManualRotateAt = Date.now();
      this.applyMapRotationNow();
    }, { passive: true });

    el.addEventListener('touchend', () => {
      this.rotTouchPrevAngle = null;
    }, { passive: true });
  }

  private getTwoFingerAngle(touches: TouchList): number {
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }

  // ── Free pan handlers ──────────────────────────────────────────────────────

  private setupFreePanHandlers(): void {
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

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  // Pass-throughs to GpsService
  public async requestLocationPermission(): Promise<boolean> {
    return this.gpsSvc.requestLocationPermission();
  }

  public async getInitialPosition(
    timeoutMs: number = 15000
  ): Promise<{ lat: number; lng: number } | null> {
    return this.gpsSvc.getInitialPosition(timeoutMs);
  }

  public async startGpsWatch(
    centerOnFirstFix: boolean = true,
    zoomOnFirstFix: number = 18
  ): Promise<void> {
    return this.gpsSvc.startGpsWatch(centerOnFirstFix, zoomOnFirstFix);
  }

  public async stopGpsWatch(): Promise<void> {
    return this.gpsSvc.stopGpsWatch();
  }

  // Pass-throughs to RouteService
  public async drawCustomRouteToDestination(
    dest: Destination,
    startPoint: L.LatLng,
    opts?: { fit?: boolean; wheelchair?: boolean }
  ): Promise<void> {
    return this.routeSvc.drawCustomRouteToDestination(dest, startPoint, opts);
  }

  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]): void {
    this.routeSvc.updateRouteProgress(passedPoints, remainingPoints);
  }

  public removeRouting(keepDestinationPin: boolean = false): void {
    this.routeSvc.removeRouting(keepDestinationPin);
  }

  public pinDestination(lat: number, lng: number, label?: string): void {
    this.routeSvc.pinDestination(lat, lng, label);
  }

  public pinDestinationByMode(
    dest: Destination,
    mode: 'center' | 'entrance' = 'center',
    label?: string
  ): void {
    this.routeSvc.pinDestinationByMode(dest, mode, label);
  }

  public previewRouteBounds(from: L.LatLng, to: L.LatLng, bottomPad = 280): void {
    if (!this.map) return;
    const bounds = L.latLngBounds([from, to]).pad(0.15);
    this.map.fitBounds(bounds, {
      paddingTopLeft: [30, 140],
      paddingBottomRight: [30, bottomPad],
      maxZoom: 17,
      animate: true,
      duration: 0.8,
    } as any);
  }

  public fitRouteToView(opts?: {
    paddingTopLeft?: [number, number];
    paddingBottomRight?: [number, number];
    maxZoom?: number;
    animate?: boolean;
  }): boolean {
    return this.routeSvc.fitRouteToView(opts);
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.routeSvc.getCurrentRoutePoints();
  }

  public getCurrentRouteDistanceMeters(): number {
    return this.routeSvc.getCurrentRouteDistanceMeters();
  }
}
