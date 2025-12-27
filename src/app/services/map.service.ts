import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';
import { Geolocation } from '@capacitor/geolocation';

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
  private debugLayer: L.LayerGroup | null = null;
  public debugGraph = true;

  public locationFound = new EventEmitter<{ lat: number; lng: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();

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

  // -----------------------------
  // GPS stability state + tuning
  // -----------------------------
  private lastRawFix: { lat: number; lng: number; ts: number; acc: number; speed: number } | null = null;
  private lastFilteredFix: { lat: number; lng: number; ts: number } | null = null;

  private lastHeadingDeg: number | null = null;
  private lastHeadingLL: L.LatLng | null = null;

  // follow-camera throttle state
  private lastFollowTs = 0;
  private lastFollowLL: L.LatLng | null = null;

  // tweakable thresholds
  private readonly GPS_MAX_ACC = 30;          // meters (25–35)
  private readonly GPS_MAX_JUMP = 25;         // meters per update (when slow)
  private readonly SNAP_TO_ROUTE_MAX = 12;    // meters (10–15)
  private readonly HEADING_MIN_SPEED = 1.0;   // m/s (walking ~1.2–1.6)

  public setFollowUser(enabled: boolean, zoom?: number) {
    this.followUser = enabled;
    this.followZoom = typeof zoom === 'number' ? zoom : null;
  }

  private userIcon = L.divIcon({
    className: 'user-marker',
    html: `<img class="user-arrow" src="assets/images/pins/arrow.png" />`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  private destIcon = L.icon({
    iconUrl: 'assets/images/pins/end-pin.png',
    iconSize: [45, 45],
    iconAnchor: [22, 45],
  });

  constructor(
    private graphService: CampusGraphService,
    private routingService: RoutingService,
  ) {}

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

  private async presentToast(message: string) {
    const toast = document.createElement('ion-toast');
    toast.message = message;
    toast.duration = 2000;
    toast.position = 'top';
    document.body.appendChild(toast);
    await toast.present();
  }

  public async requestLocationPermission(): Promise<boolean> {
    const p = await Geolocation.checkPermissions();
    if (p.location === 'granted' || (p as any).coarseLocation === 'granted') return true;

    const req = await Geolocation.requestPermissions({ permissions: ['location'] as any });
    return req.location === 'granted' || (req as any).coarseLocation === 'granted';
  }

  private async ensureLocationPermission(): Promise<boolean> {
    return this.requestLocationPermission();
  }

  initializeMap(lat: number, lng: number, elementId: string) {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }

    this.map = L.map(elementId, {
      zoomControl: false,
      keyboard: true,
      maxZoom: 19,
    }).setView([lat, lng], 18);

    this.setBaseLayer('maptiler-osm', 'fFUNZQgQLPQX2iZWUJ8w');

    this.setupUserMarker(lat, lng);
    this.setupMapClickEvent();

    if (!this.debugLayer) {
      this.debugLayer = L.layerGroup().addTo(this.map);
    }
  }

  private setupUserMarker(lat: number, lng: number) {
    if (!this.map) return;

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
      return;
    }

    this.userMarker = L.marker([lat, lng], { icon: this.userIcon }).addTo(this.map);
  }

  public async startGpsWatch() {
    if (this.watchId) return;

    const ok = await this.ensureLocationPermission();
    if (!ok) {
      this.locationError.emit();
      return;
    }

    // warm-up
    try {
      await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    } catch {}

    try {
      this.watchId = await Geolocation.watchPosition(
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        },
        (pos, err) => {
          if (err || !pos) {
            this.locationError.emit();
            return;
          }

          const rawLat = pos.coords.latitude;
          const rawLng = pos.coords.longitude;
          const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : 999;
          const speed = typeof pos.coords.speed === 'number' ? pos.coords.speed : 0;
          const ts = typeof pos.timestamp === 'number' ? pos.timestamp : Date.now();

          // 1) reject bad accuracy
          if (acc > this.GPS_MAX_ACC) return;

          // 2) reject "jump" when slow (helps a lot on Android jitter)
          if (this.lastRawFix) {
            const dt = ts - this.lastRawFix.ts;
            if (dt >= 600) {
              const d = L.latLng(rawLat, rawLng).distanceTo(L.latLng(this.lastRawFix.lat, this.lastRawFix.lng));
              if (d > this.GPS_MAX_JUMP && speed < 3) {
                this.lastRawFix = { lat: rawLat, lng: rawLng, ts, acc, speed };
                return;
              }
            }
          }
          this.lastRawFix = { lat: rawLat, lng: rawLng, ts, acc, speed };

          // 3) EMA smoothing
          const alpha = this.clamp(1 - acc / this.GPS_MAX_ACC, 0.15, 0.65);

          let fLat = rawLat;
          let fLng = rawLng;

          if (!this.lastFilteredFix) {
            this.lastFilteredFix = { lat: rawLat, lng: rawLng, ts };
          } else {
            fLat = this.lastFilteredFix.lat + alpha * (rawLat - this.lastFilteredFix.lat);
            fLng = this.lastFilteredFix.lng + alpha * (rawLng - this.lastFilteredFix.lng);
            this.lastFilteredFix = { lat: fLat, lng: fLng, ts };
          }

          let shown = L.latLng(fLat, fLng);

          // 4) snap to route (map-matching-lite)
          if (this.currentRoutePoints && this.currentRoutePoints.length >= 2) {
            const { point: snapped, distM } = this.closestPointOnPolyline(shown, this.currentRoutePoints);
            if (distM <= this.SNAP_TO_ROUTE_MAX) {
              shown = snapped;
            }
          }

          // 5) stable heading (bearing from movement) + smoothing, freeze when slow
          if (!this.lastHeadingLL) this.lastHeadingLL = shown;

          const moved = this.lastHeadingLL.distanceTo(shown);
          if (speed >= this.HEADING_MIN_SPEED || moved >= 1.5) {
            const b = this.bearingDeg(this.lastHeadingLL, shown);
            if (this.lastHeadingDeg == null) this.lastHeadingDeg = b;
            else this.lastHeadingDeg = this.smoothHeading(this.lastHeadingDeg, b, 0.25);

            this.setUserHeading(this.lastHeadingDeg);
            this.lastHeadingLL = shown;
          }

          // 6) update marker + emit
          this.updateUserPosition(shown.lat, shown.lng);
          this.locationFound.emit({ lat: shown.lat, lng: shown.lng });
        }
      );
    } catch {
      this.locationError.emit();
    }
  }

  public async stopGpsWatch() {
    if (!this.watchId) return;
    try {
      await Geolocation.clearWatch({ id: this.watchId });
    } finally {
      this.watchId = null;
    }
  }

  public focusOn(lat: number, lng: number, zoom: number = 19) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  public setUserHeading(deg: number) {
    if (!this.userMarker) return;
    const el = this.userMarker.getElement();
    if (!el) return;

    const img = el.querySelector('img.user-arrow') as HTMLImageElement | null;
    if (!img) return;

    img.style.transformOrigin = '50% 50%';
    img.style.transform = `rotate(${deg}deg)`;
  }

  private setBaseLayer(
    style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm',
    apiKey?: string
  ) {
    if (!this.map) return;

    if (this.baseLayer) this.map.removeLayer(this.baseLayer);

    const layers: Record<string, { url: string; opt: L.TileLayerOptions }> = {
      osm: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opt: { attribution: '© OpenStreetMap contributors' },
      },
      positron: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO' },
      },
      dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        opt: { attribution: '© OpenStreetMap contributors, © CARTO' },
      },
      'maptiler-outdoor': {
        url: `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: {
          attribution: '© OpenStreetMap | © MapTiler',
          tileSize: 512,
          zoomOffset: -1,
          maxZoom: 19,
          maxNativeZoom: 19,
        },
      },
      'maptiler-osm': {
        url: `https://api.maptiler.com/maps/openstreetmap/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: {
          attribution: '© OpenStreetMap | © MapTiler',
          tileSize: 512,
          zoomOffset: -1,
          maxZoom: 19,
          maxNativeZoom: 19,
        },
      },
    };

    this.baseLayer = L.tileLayer(layers[style].url, layers[style].opt).addTo(this.map);
  }

  private setupMapClickEvent() {
    if (!this.map) return;

    this.map.on('click', async (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      if (!this.isInsideCampus(clickedLat, clickedLng)) {
        await this.presentToast('Αυτό το σημείο είναι εκτός campus. Παρακαλώ επίλεξε άλλο.');
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

    // clear old
    if (this.currentPolyline) { this.map.removeLayer(this.currentPolyline); this.currentPolyline = null; }
    if (this.passedPolyline) { this.map.removeLayer(this.passedPolyline); this.passedPolyline = null; }
    if (this.approachPolyline) { this.map.removeLayer(this.approachPolyline); this.approachPolyline = null; }
    if (this.endApproachPolyline) { this.map.removeLayer(this.endApproachPolyline); this.endApproachPolyline = null; }
    this.routingService.removeRouting(this.map);

    if (this.debugLayer) this.debugLayer.clearLayers();

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

    if (this.debugGraph) {
      const nodeIds = this.graphService.calculatePathNodeIds(startNodeId, endNodeId);
      if (nodeIds) {
        console.log('[ROUTE NODE IDS]', nodeIds.join(' -> '));
        nodeIds.forEach((id, idx) => {
          const ll = this.graphService.getNodeLatLng(id);
          if (!ll) return;
          const m = L.circleMarker(ll, { radius: 5, weight: 2, opacity: 0.9, fillOpacity: 0.4 });
          m.bindTooltip(`${idx}: ${id}`, { permanent: false, direction: 'top' });
          this.debugLayer?.addLayer(m);
        });
      }
    }
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

  // reset gps filter state that depended on route
  this.lastFilteredFix = null;
  this.lastHeadingLL = null;
  this.lastHeadingDeg = null;


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

  public updateUserPosition(lat: number, lng: number) {
    const ll = L.latLng(lat, lng);

    if (this.userMarker) {
      this.userMarker.setLatLng(ll);
    }

    // Follow camera (throttled)
    if (this.map && this.followUser) {
      const now = Date.now();
      const movedEnough = !this.lastFollowLL || this.lastFollowLL.distanceTo(ll) > 2.5;
      const timeOk = now - this.lastFollowTs > 450; // ~2 updates/sec

      if (movedEnough && timeOk) {
        this.lastFollowTs = now;
        this.lastFollowLL = ll;

        const z = this.followZoom ?? this.map.getZoom();
        this.map.panTo(ll, { animate: true, duration: 0.5 });
        if (this.map.getZoom() !== z) this.map.setZoom(z);
      }
    }
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  // -----------------------------
  // Helpers (math + snapping)
  // -----------------------------
  private clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

  private wrapDeg(d: number) { return (d % 360 + 360) % 360; }

  private angDiff(a: number, b: number) {
    const d = this.wrapDeg(a - b);
    return d > 180 ? d - 360 : d; // -180..180
  }

  private smoothHeading(prev: number, next: number, alpha: number) {
    return this.wrapDeg(prev + alpha * this.angDiff(next, prev));
  }

  private bearingDeg(a: L.LatLng, b: L.LatLng) {
    const toRad = (x: number) => x * Math.PI / 180;
    const toDeg = (x: number) => x * 180 / Math.PI;
    const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
    const λ1 = toRad(a.lng), λ2 = toRad(b.lng);
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    return this.wrapDeg(toDeg(Math.atan2(y, x)));
  }

  private projectToMeters(ll: L.LatLng) {
    const p = L.CRS.EPSG3857.project(ll);
    return L.point(p.x, p.y);
  }

  private unprojectFromMeters(p: L.Point) {
    return L.CRS.EPSG3857.unproject(L.point(p.x, p.y));
  }

  private closestPointOnPolyline(user: L.LatLng, line: L.LatLng[]) {
    if (!line || line.length < 2) return { point: user, distM: Infinity };

    const u = this.projectToMeters(user);
    let bestP = user;
    let bestD = Infinity;

    for (let i = 0; i < line.length - 1; i++) {
      const a = this.projectToMeters(line[i]);
      const b = this.projectToMeters(line[i + 1]);

      const abx = b.x - a.x, aby = b.y - a.y;
      const apx = u.x - a.x, apy = u.y - a.y;

      const ab2 = abx * abx + aby * aby;
      if (ab2 === 0) continue;

      let t = (apx * abx + apy * aby) / ab2;
      t = Math.max(0, Math.min(1, t));

      const px = a.x + t * abx;
      const py = a.y + t * aby;

      const dx = u.x - px;
      const dy = u.y - py;
      const d = Math.sqrt(dx * dx + dy * dy);

      if (d < bestD) {
        bestD = d;
        bestP = this.unprojectFromMeters(L.point(px, py));
      }
    }

    return { point: bestP, distM: bestD };
  }
}
