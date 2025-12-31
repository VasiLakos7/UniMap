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

  // ✅ recenter + smooth follow
  private lastUserLatLng: L.LatLng | null = null;
  private lastCamMoveAt = 0;
  private lastCamLL: L.LatLng | null = null;

  private readonly CAM_MIN_INTERVAL_MS = 650;
  private readonly CAM_MIN_MOVE_M = 5;

  public locationFound = new EventEmitter<{ lat: number; lng: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();
  public outsideCampusClick = new EventEmitter<void>();

  public routeProgress = new EventEmitter<{
    passedMeters: number;
    remainingMeters: number;
    totalMeters: number;
    progress: number;
  }>();

  private destinationList = destinationList;
  public currentRoutePoints: L.LatLng[] = [];

  private followUser = false;
  private followZoom: number | null = null;

  private watchId: string | null = null;
  private webWatchId: number | null = null;

  private hasInitialFix = false;

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
    html: `<span class="dot"></span><span class="halo"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

  // ✅ default: BLUE DOT (idle)
  private activeUserStyle: 'arrow' | 'dot' = 'dot';

  public setUserMarkerStyle(style: 'arrow' | 'dot') {
    this.activeUserStyle = style;

    if (!this.userMarker) return;
    const icon = style === 'arrow' ? this.userArrowIcon : this.userDotIcon;
    this.userMarker.setIcon(icon);
  }

  // ✅ one-liner API for HomePage
  public setNavigationMode(active: boolean) {
    this.setUserMarkerStyle(active ? 'arrow' : 'dot');
  }

  // -----------------------------
  // Destination pin icon
  // -----------------------------
  private destIcon = L.icon({
    iconUrl: 'assets/images/pins/end-pin.png',
    iconSize: [45, 45],
    iconAnchor: [22, 45],
  });

  constructor(
    private graphService: CampusGraphService,
    private routingService: RoutingService,
  ) {}

  // -----------------------------
  // Campus polygon (for click validation)
  // -----------------------------
  private campusBoundary = L.polygon([
    [40.659484, 22.801706],
    [40.659338, 22.806507],
    [40.654901, 22.806625],
    [40.655500, 22.801840],
  ]);

  private isInsideCampus(lat: number, lng: number): boolean {
    const polygon = this.campusBoundary.getLatLngs()[0] as L.LatLng[];
    const x = lng;
    const y = lat;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;

      const intersect =
        ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }
    return inside;
  }

  public isPointInsideCampus(lat: number, lng: number): boolean {
    return this.isInsideCampus(lat, lng);
  }

  private campusBounds = this.campusBoundary.getBounds();

  // -----------------------------
  // FOLLOW + RECENTER
  // -----------------------------
  public setFollowUser(enabled: boolean, zoom?: number) {
    this.followUser = enabled;
    this.followZoom = typeof zoom === 'number' ? zoom : null;

    // reset smooth follow state when enabled
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
    // WEB
    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) return null;

      return await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 0 }
        );
      });
    }

    // NATIVE
    const ok = await this.ensureLocationPermission();
    if (!ok) return null;

    try {
      const first = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      });

      return { lat: first.coords.latitude, lng: first.coords.longitude };
    } catch {
      return null;
    }
  }

  // -----------------------------
  // MAP INIT
  // -----------------------------
  initializeMap(lat: number, lng: number, elementId: string) {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }

    this.map = L.map(elementId, {
      zoomControl: false,
      keyboard: true,
      maxZoom: 22,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      // (αν θες να το κλειδώσεις campus, βάλε maxBounds εδώ — αλλά τότε εκτός campus δεν θα βλέπεις θέση)
      // maxBounds: this.campusBounds,
      // maxBoundsViscosity: 1.0,
    }).setView([lat, lng], 18);

    this.setBaseLayer('maptiler-osm', 'fFUNZQgQLPQX2iZWUJ8w');

    // ✅ ensure idle style on init
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
      if (!e?.originalEvent) return; // ✅ only real user gestures
      this.setFollowUser(false);
    };

    this.map.on('dragstart', stopFollowIfUser);
    this.map.on('zoomstart', stopFollowIfUser);
    // movestart fires from code too, but we guard with originalEvent
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

  public setBaseLayerFromSettings(mode: 'osm' | 'maptiler') {
    if (mode === 'maptiler') {
      this.setBaseLayer('maptiler-osm', 'fFUNZQgQLPQX2iZWUJ8w');
    } else {
      this.setBaseLayer('osm');
    }
  }

  public refreshMap() {
    if (!this.map) return;
    setTimeout(() => {
      this.map.invalidateSize(true);
      try { this.baseLayer?.redraw?.(); } catch {}
    }, 60);
  }

  public setNorthLock(_enabled: boolean) {}

  // -----------------------------
  // GPS WATCH
  // -----------------------------
  public async startGpsWatch(centerOnFirstFix: boolean = true, zoomOnFirstFix: number = 18) {
    await this.stopGpsWatch();
    this.hasInitialFix = false;

    // -------- WEB --------
    if (!Capacitor.isNativePlatform()) {
      if (!('geolocation' in navigator)) {
        this.locationError.emit();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          this.updateUserPosition(lat, lng);
          this.locationFound.emit({ lat, lng });

          if (centerOnFirstFix && !this.hasInitialFix && this.map) {
            this.hasInitialFix = true;
            try { this.map.setView([lat, lng], zoomOnFirstFix, { animate: true }); } catch {}
          }
        },
        () => this.locationError.emit(),
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }
      );

      this.webWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          this.updateUserPosition(lat, lng);
          this.locationFound.emit({ lat, lng });

          if (centerOnFirstFix && !this.hasInitialFix && this.map) {
            this.hasInitialFix = true;
            try { this.map.setView([lat, lng], zoomOnFirstFix, { animate: true }); } catch {}
          }
        },
        () => this.locationError.emit(),
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }
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
        timeout: 20000,
        maximumAge: 10000,
      });

      const lat = first.coords.latitude;
      const lng = first.coords.longitude;

      this.updateUserPosition(lat, lng);
      this.locationFound.emit({ lat, lng });

      if (centerOnFirstFix && !this.hasInitialFix && this.map) {
        this.hasInitialFix = true;
        try { this.map.setView([lat, lng], zoomOnFirstFix, { animate: true }); } catch {}
      }
    } catch {
      // ignore
    }

    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
        (pos, err) => {
          if (err || !pos) {
            this.locationError.emit();
            return;
          }

          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;

          this.updateUserPosition(lat, lng);
          this.locationFound.emit({ lat, lng });

          if (centerOnFirstFix && !this.hasInitialFix && this.map) {
            this.hasInitialFix = true;
            try { this.map.setView([lat, lng], zoomOnFirstFix, { animate: true }); } catch {}
          }
        }
      );
    } catch {
      this.locationError.emit();
    }
  }

  public async stopGpsWatch() {
    if (this.webWatchId != null) {
      try { navigator.geolocation.clearWatch(this.webWatchId); } catch {}
      this.webWatchId = null;
    }

    if (this.watchId) {
      try { await Geolocation.clearWatch({ id: this.watchId }); } catch {}
      this.watchId = null;
    }
  }

  public focusOn(lat: number, lng: number, zoom: number = 19) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  public setUserHeading(deg: number) {
    // ✅ only rotate when arrow is active
    if (this.activeUserStyle !== 'arrow') return;

    if (!this.userMarker) return;
    const el = this.userMarker.getElement();
    if (!el) return;

    const img = el.querySelector('img.user-arrow') as HTMLImageElement | null;
    if (!img) return;

    img.style.transformOrigin = '50% 50%';
    img.style.transform = `rotate(${deg}deg)`;
  }

  // -----------------------------
  // BASE LAYER
  // -----------------------------
  private setBaseLayer(
    style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm',
    apiKey?: string
  ) {
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
  }

  // -----------------------------
  // MAP CLICK
  // -----------------------------
  private setupMapClickEvent() {
    if (!this.map) return;

    this.map.on('click', async (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      if (!this.isInsideCampus(clickedLat, clickedLng)) {
        this.outsideCampusClick.emit();
        return;
      }

      const found = this.destinationList.find((dest: Destination) => {
        const b = dest.bounds;
        if (!b) return false;
        return (
          clickedLat >= b.south &&
          clickedLat <= b.north &&
          clickedLng >= b.west &&
          clickedLng <= b.east
        );
      });

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

    this.map.setView(to, Math.min(19, this.map.getZoom() || 19));
  }

  // -----------------------------
  // ROUTING (custom graph)
  // -----------------------------
  private sumDistanceMeters(points: L.LatLng[]): number {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += points[i - 1].distanceTo(points[i]);
    }
    return total;
  }

  public getCurrentRouteDistanceMeters(): number {
    return this.sumDistanceMeters(this.currentRoutePoints);
  }

  public async drawCustomRouteToDestination(dest: Destination, startPoint: L.LatLng) {
    if (!this.map) return;

    if (this.currentPolyline) { this.map.removeLayer(this.currentPolyline); this.currentPolyline = null; }
    if (this.passedPolyline) { this.map.removeLayer(this.passedPolyline); this.passedPolyline = null; }
    if (this.approachPolyline) { this.map.removeLayer(this.approachPolyline); this.approachPolyline = null; }
    if (this.endApproachPolyline) { this.map.removeLayer(this.endApproachPolyline); this.endApproachPolyline = null; }
    this.routingService.removeRouting(this.map);

    const destLat = dest.entranceLat ?? dest.lat;
    const destLng = dest.entranceLng ?? dest.lng;
    const endPoint = L.latLng(destLat, destLng);

    this.pinDestination(destLat, destLng, dest.name);

    let endNodeId =
      this.graphService.getNodeIdForName(dest.name) ||
      this.graphService.findNearestNodeId(destLat, destLng);

    if (!endNodeId) return;

    let startNodeId: string | null =
      this.graphService.findNearestNodeId(startPoint.lat, startPoint.lng);

    if (!startNodeId) {
      startNodeId = this.graphService.findBestStartNodeForDestination(
        startPoint.lat,
        startPoint.lng,
        endNodeId
      );
    }
    if (!startNodeId) return;

    const pathNodes = this.graphService.calculatePath(startNodeId, endNodeId);
    if (!pathNodes || pathNodes.length < 1) return;

    const startNodeCoords = this.graphService.getDestinationCoords(startNodeId);
    if (!startNodeCoords) return;

    const mainRoutePoints: L.LatLng[] = [...pathNodes];

    const lastNode = mainRoutePoints[mainRoutePoints.length - 1];
    const endGap = lastNode ? lastNode.distanceTo(endPoint) : Infinity;

    this.currentRoutePoints = [startPoint, startNodeCoords, ...mainRoutePoints];
    if (isFinite(endGap) && endGap > 1) {
      this.currentRoutePoints.push(endPoint);
    }

    if (startPoint.distanceTo(startNodeCoords) > 1) {
      this.approachPolyline = L.polyline([startPoint, startNodeCoords], {
        color: '#666666',
        weight: 3,
        opacity: 0.7,
        dashArray: '4 8',
      }).addTo(this.map);
    }

    this.currentPolyline = L.polyline(mainRoutePoints, {
      color: '#007bff',
      weight: 6,
      opacity: 0.9,
    }).addTo(this.map);

    if (isFinite(endGap) && endGap > 1) {
      this.endApproachPolyline = L.polyline([lastNode, endPoint], {
        color: '#007bff',
        weight: 5,
        opacity: 0.7,
        dashArray: '6 10',
      }).addTo(this.map);
    }

    const boundsPoints = [startPoint, startNodeCoords, ...mainRoutePoints];
    if (isFinite(endGap) && endGap > 1) boundsPoints.push(endPoint);
    const bounds = L.latLngBounds(boundsPoints);

    this.map.fitBounds(bounds, {
      paddingTopLeft: [30, 140],
      paddingBottomRight: [30, 260],
      maxZoom: 18,
      animate: true,
      duration: 0.7,
    });

    const totalMeters = this.getCurrentRouteDistanceMeters();
    this.routeProgress.emit({
      passedMeters: 0,
      remainingMeters: totalMeters,
      totalMeters,
      progress: 0,
    });
  }

  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]) {
    if (!this.map) return;

    if (passedPoints && passedPoints.length >= 2) {
      if (!this.passedPolyline) {
        this.passedPolyline = L.polyline(passedPoints, { color: '#777777', weight: 4, opacity: 0.4 }).addTo(this.map);
      } else {
        this.passedPolyline.setLatLngs(passedPoints);
      }
    }

    if (remainingPoints && remainingPoints.length >= 2) {
      if (!this.currentPolyline) {
        this.currentPolyline = L.polyline(remainingPoints, { color: '#007bff', weight: 6, opacity: 0.9 }).addTo(this.map);
      } else {
        this.currentPolyline.setLatLngs(remainingPoints);
      }
    } else {
      if (this.currentPolyline) {
        this.map.removeLayer(this.currentPolyline);
        this.currentPolyline = null;
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

    if (this.currentPolyline) { this.map.removeLayer(this.currentPolyline); this.currentPolyline = null; }
    if (this.passedPolyline) { this.map.removeLayer(this.passedPolyline); this.passedPolyline = null; }
    if (this.approachPolyline) { this.map.removeLayer(this.approachPolyline); this.approachPolyline = null; }
    if (this.endApproachPolyline) { this.map.removeLayer(this.endApproachPolyline); this.endApproachPolyline = null; }

    if (!keepDestinationPin) {
      if (this.destinationMarker) { this.map.removeLayer(this.destinationMarker); this.destinationMarker = null; }
    }

    this.routingService.removeRouting(this.map);
    this.currentRoutePoints = [];

    this.routeProgress.emit({
      passedMeters: 0,
      remainingMeters: 0,
      totalMeters: 0,
      progress: 0
    });
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.currentRoutePoints;
  }

  // -----------------------------
  // USER MARKER + FOLLOW CAMERA
  // -----------------------------
  public updateUserPosition(lat: number, lng: number) {
    const ll = L.latLng(lat, lng);

    // ✅ keep last user fix for recenter
    this.lastUserLatLng = ll;

    if (this.userMarker) {
      this.userMarker.setLatLng(ll);
    }

    // ✅ smooth follow (throttle + move threshold)
    if (this.map && this.followUser) {
      const now = Date.now();
      const movedM = this.lastCamLL ? this.lastCamLL.distanceTo(ll) : Infinity;

      const tooSoon = (now - this.lastCamMoveAt) < this.CAM_MIN_INTERVAL_MS;
      const tooSmall = movedM < this.CAM_MIN_MOVE_M;

      if (!(tooSoon && tooSmall)) {
        this.lastCamMoveAt = now;
        this.lastCamLL = ll;

        const z = this.followZoom ?? this.map.getZoom();

        this.map.panTo(ll, { animate: true, duration: 0.45 });
        if (this.map.getZoom() !== z) this.map.setZoom(z);
      }
    }
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }
}
