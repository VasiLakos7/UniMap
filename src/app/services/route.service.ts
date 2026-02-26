import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';

import { Destination, destinationList } from '../models/destination.model';
import { ApiService } from './api.service';
import { RoutingService } from './routing.service';
import { bearingDeg, smoothAngle, sumDistanceMeters } from './map-geo.utils';

@Injectable({ providedIn: 'root' })
export class RouteService {
  private map!: L.Map;

  // Route layers
  private currentPolyline: L.Polyline | null = null;
  private passedPolyline: L.Polyline | null = null;
  private approachPolyline: L.Polyline | null = null;
  private endApproachPolyline: L.Polyline | null = null;
  private destinationMarker: L.Marker | null = null;

  // Route data
  public currentRoutePoints: L.LatLng[] = [];
  private lastRouteBounds: L.LatLngBounds | null = null;
  private activeWheelchair = false;

  // Active navigation targets
  private activeDestination: Destination | null = null;
  private activeEndPoint: L.LatLng | null = null;
  private rerouteEnabled = false;

  // Reroute state
  private offRouteStreak = 0;
  private lastRerouteAt = 0;
  private cumulativePassedM = 0;
  private lastOnRoutePassedM = 0;
  private readonly REROUTE_COOLDOWN_MS = 3000;
  private readonly REROUTE_CONFIRM_FIXES = 2;
  private readonly REROUTE_OFF_M = 18;
  private readonly REROUTE_ON_M = 10;
  private readonly REROUTE_MAX_ACC_M = 25;
  private readonly REROUTE_MIN_SPEED_MPS = 0.35;
  private readonly REROUTE_SKIP_NEAR_DEST_M = 45;
  private readonly REROUTE_FULL_REBUILD_M = 0;

  // Snap state
  private mapMatchEnabled = false;
  private snapEngaged = false;
  private lastSnapLL: L.LatLng | null = null;
  private readonly SNAP_ENTER_M = 12;
  private readonly SNAP_EXIT_M = 20;
  private readonly SNAP_FULL_M = 3;
  private readonly SNAP_BLEND_M = 14;
  private readonly SNAP_MIN_SPEED_MPS = 0.25;

  // Arrival
  public arrivedNearPin = new EventEmitter<void>();
  private arrivedNearPinTriggered = false;
  private readonly ARRIVE_PIN_DIST_M = 6.0;
  private readonly ARRIVE_PIN_MAX_ACC_M = 30;

  // Progress
  public routeProgress = new EventEmitter<{
    passedMeters: number;
    remainingMeters: number;
    totalMeters: number;
    progress: number;
  }>();

  // Icons
  private destIcon = L.icon({
    iconUrl: 'assets/images/pins/end-pin.png',
    iconSize: [45, 45],
    iconAnchor: [22, 45],
  });

  private destinationList = destinationList;

  constructor(private apiService: ApiService, private routingService: RoutingService) {}

  registerMap(map: L.Map): void {
    this.map = map;
  }

  setMapMatchEnabled(active: boolean): void {
    this.mapMatchEnabled = active;
    this.rerouteEnabled = active;

    if (!active) {
      this.offRouteStreak = 0;
      this.lastRerouteAt = 0;
      this.snapEngaged = false;
      this.lastSnapLL = null;
      this.activeWheelchair = false;
      this.activeDestination = null;
      this.activeEndPoint = null;
    }
  }

  isMapMatchEnabled(): boolean {
    return this.mapMatchEnabled;
  }

  isSnapEngaged(): boolean {
    return this.snapEngaged;
  }

  resetSnapState(): void {
    this.snapEngaged = false;
    this.lastSnapLL = null;
  }

  computeSnappedPosition(
    rawNow: L.LatLng,
    spd: number,
    acc: number,
    applyHeadingCb: (deg: number) => void,
    lastHeadingDeg: number | null,
    currentSmoothLL: L.LatLng | null
  ): { chosen: L.LatLng; resetSmooth: boolean } {
    let chosen = rawNow;
    let resetSmooth = false;

    if (!this.mapMatchEnabled || this.currentRoutePoints.length < 2) {
      return { chosen, resetSmooth };
    }

    const canSnap = spd >= this.SNAP_MIN_SPEED_MPS || acc <= 20;

    if (!canSnap) {
      this.snapEngaged = false;
      this.lastSnapLL = null;
      return { chosen, resetSmooth };
    }

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
            const deg = bearingDeg(prevSnap, target);
            const sm = smoothAngle(lastHeadingDeg, deg, 0.25);
            applyHeadingCb(sm);
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

        if (!currentSmoothLL || currentSmoothLL.distanceTo(chosen) > 5) {
          resetSmooth = true;
        }
      }
    }

    return { chosen, resetSmooth };
  }

  // Arrival
  checkArrival(rawNow: L.LatLng, acc: number): void {
    if (this.arrivedNearPinTriggered) return;
    if (!this.mapMatchEnabled) return;
    if (!this.activeEndPoint) return;
    if (this.currentRoutePoints.length < 2) return;

    const accOk = isFinite(acc) && acc <= this.ARRIVE_PIN_MAX_ACC_M;
    if (!accOk) return;

    const d = rawNow.distanceTo(this.activeEndPoint);
    if (isFinite(d) && d <= this.ARRIVE_PIN_DIST_M) {
      this.arrivedNearPinTriggered = true;
      this.arrivedNearPin.emit();
    }
  }

  async maybeReroute(rawNow: L.LatLng, accM: number, spdMps: number): Promise<void> {
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
    }

    if (this.offRouteStreak < this.REROUTE_CONFIRM_FIXES) return;

    this.offRouteStreak = 0;
    this.lastRerouteAt = now;

    // Accumulate walked meters before rebuilding
    this.cumulativePassedM += this.lastOnRoutePassedM;
    this.lastOnRoutePassedM = 0;

    if (offM >= this.REROUTE_FULL_REBUILD_M) {
      await this.drawCustomRouteToDestination(this.activeDestination, rawNow, {
        fit: false,
        wheelchair: this.activeWheelchair,
        isReroute: true,
      });
      return;
    }

    this.applyPartialRerouteFromSnap(rawNow, snap.snap, snap.segStartIndex);
  }

  private applyPartialRerouteFromSnap(
    rawNow: L.LatLng,
    snapPoint: L.LatLng,
    segStartIndex: number
  ): void {
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

  // Route drawing
  public async drawCustomRouteToDestination(
    dest: Destination,
    startPoint: L.LatLng,
    opts?: { fit?: boolean; wheelchair?: boolean; isReroute?: boolean }
  ): Promise<void> {
    this.activeWheelchair = !!opts?.wheelchair;
    if (!opts?.isReroute) {
      this.cumulativePassedM = 0;
      this.lastOnRoutePassedM = 0;
    }

    if (!this.map) return;

    this.arrivedNearPinTriggered = false;
    this.activeDestination = dest;
    this.rerouteEnabled = true;
    this.offRouteStreak = 0;

    const destLat = dest.entranceLat ?? dest.lat;
    const destLng = dest.entranceLng ?? dest.lng;
    const endPoint = L.latLng(destLat, destLng);
    this.activeEndPoint = endPoint;

    const APPROACH_START_M = 38;
    const distToDestNow = startPoint.distanceTo(endPoint);

    if (isFinite(distToDestNow) && distToDestNow <= APPROACH_START_M) {
      this.clearRouteLayers();
      this.pinDestination(destLat, destLng, dest.name);
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

      const remainingMeters = this.getCurrentRouteDistanceMeters();
      const totalMeters = this.cumulativePassedM + remainingMeters;
      this.routeProgress.emit({
        passedMeters: this.cumulativePassedM,
        remainingMeters,
        totalMeters,
        progress: totalMeters > 0 ? this.cumulativePassedM / totalMeters : 0,
      });
      return;
    }

    // Fetch new route — keep old layers visible during the API call
    let routeResult: { path: { lat: number; lng: number }[]; lengthM: number };
    try {
      routeResult = await this.apiService.getCampusRoute({
        fromLat: startPoint.lat,
        fromLng: startPoint.lng,
        destinationName: dest.name,
        destLat,
        destLng,
        wheelchair: !!opts?.wheelchair,
      });
    } catch (err) {
      console.error('[RouteService] drawCustomRouteToDestination API error:', err);
      throw err;
    }

    if (!routeResult.path || routeResult.path.length < 1) {
      console.warn('[RouteService] API returned empty path');
      return;
    }

    // Swap layers now that new route is ready
    this.clearRouteLayers();
    this.pinDestination(destLat, destLng, dest.name);

    const pathNodes: L.LatLng[] = routeResult.path.map(p => L.latLng(p.lat, p.lng));

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

    // Build route starting from first graph node (not GPS position)
    // to avoid diagonal approach lines through buildings
    const pts: L.LatLng[] = [];
    for (const p of mainRoutePoints) {
      if (pts.length === 0 || !this.almostSame(pts[pts.length - 1], p)) pts.push(p);
    }
    if (!this.almostSame(pts[pts.length - 1], endPoint)) pts.push(endPoint);

    const trimmed = this.trimEndBacktrack(pts, endPoint, { maxSnapM: 60, minSaveM: 5, window: 20 });

    this.currentRoutePoints = trimmed;
    const drawPts = this.currentRoutePoints;

    // Draw grey dashed approach from GPS to first graph node if close enough
    const START_APPROACH_MAX_M = 50;
    const firstNode = drawPts[0];
    const distToFirstNode = startPoint.distanceTo(firstNode);
    if (distToFirstNode > 1 && distToFirstNode <= START_APPROACH_MAX_M) {
      this.approachPolyline = L.polyline([startPoint, firstNode], {
        color: '#666666',
        weight: 3,
        opacity: 0.75,
        dashArray: '6 10',
        lineCap: 'round',
      }).addTo(this.map);
    }

    if (drawPts.length >= 2) {
      if (drawPts.length >= 3) {
        const solid = drawPts.slice(0, -1);

        if (solid.length >= 2) {
          this.currentPolyline = L.polyline(solid, {
            color: '#007bff',
            weight: 6,
            opacity: 0.9,
          }).addTo(this.map);
        }

        this.drawEndApproach(drawPts[drawPts.length - 2], drawPts[drawPts.length - 1]);
      } else {
        this.drawEndApproach(drawPts[0], drawPts[1]);
      }
    }

    const bounds = L.latLngBounds(drawPts);
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

    const remainingMeters = this.getCurrentRouteDistanceMeters();
    const totalMeters = this.cumulativePassedM + remainingMeters;
    this.routeProgress.emit({
      passedMeters: this.cumulativePassedM,
      remainingMeters,
      totalMeters,
      progress: totalMeters > 0 ? this.cumulativePassedM / totalMeters : 0,
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

  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]): void {
    if (!this.map) return;

    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }

    if (passedPoints && passedPoints.length >= 2) {
      if (!this.passedPolyline) {
        this.passedPolyline = L.polyline(passedPoints, {
          color: '#777777',
          weight: 4,
          opacity: 0.4,
        }).addTo(this.map);
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
          this.currentPolyline = L.polyline(solid, {
            color: '#007bff',
            weight: 6,
            opacity: 0.9,
          }).addTo(this.map);
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

    const onRoutePassed = sumDistanceMeters(passedPoints);
    this.lastOnRoutePassedM = onRoutePassed;
    const passedMeters = this.cumulativePassedM + onRoutePassed;
    const remainingMeters = sumDistanceMeters(remainingPoints);
    const totalMeters = passedMeters + remainingMeters;
    const progress = totalMeters > 0 ? passedMeters / totalMeters : 0;

    this.routeProgress.emit({ passedMeters, remainingMeters, totalMeters, progress });
  }

  public removeRouting(keepDestinationPin: boolean = false): void {
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

    this.activeDestination = null;
    this.activeEndPoint = null;
    this.rerouteEnabled = false;
    this.offRouteStreak = 0;
    this.lastRerouteAt = 0;
    this.cumulativePassedM = 0;
    this.lastOnRoutePassedM = 0;

    this.arrivedNearPinTriggered = false;
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.currentRoutePoints;
  }

  public getCurrentRouteDistanceMeters(): number {
    return sumDistanceMeters(this.currentRoutePoints);
  }

  // Destination pin
  public pinDestination(lat: number, lng: number, label?: string): void {
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

  public pinDestinationByMode(
    dest: Destination,
    mode: 'center' | 'entrance' = 'center',
    label?: string
  ): void {
    const ll = this.getDestPoint(dest, mode);
    this.pinDestination(ll.lat, ll.lng, label ?? dest.name);
  }

  public findNearestDestinationWithin(
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

  private getDestPoint(dest: Destination, mode: 'center' | 'entrance' = 'center'): L.LatLng {
    if (mode === 'entrance' && dest.entranceLat != null && dest.entranceLng != null) {
      return L.latLng(dest.entranceLat, dest.entranceLng);
    }
    return L.latLng(dest.lat, dest.lng);
  }

  // Snap helpers
  private closestPointOnSegmentMeters(
    p: L.Point,
    a: L.Point,
    b: L.Point
  ): { pt: L.Point; dist: number } {
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

  private snapToRouteWithIndex(
    raw: L.LatLng
  ): { snap: L.LatLng; segStartIndex: number; distM: number } | null {
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

  // Route layer helpers
  private clearRouteLayers(): void {
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

  private drawEndApproach(from: L.LatLng, to: L.LatLng): void {
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

  private almostSame(a: L.LatLng, b: L.LatLng, epsM: number = 0.7): boolean {
    return a.distanceTo(b) <= epsM;
  }


  private trimEndBacktrack(
    points: L.LatLng[],
    endPoint: L.LatLng,
    opts?: { maxSnapM?: number; minSaveM?: number; window?: number }
  ): L.LatLng[] {
    const maxSnapM = opts?.maxSnapM ?? 28;
    const minSaveM = opts?.minSaveM ?? 7;
    const window = opts?.window ?? 8;

    if (!points || points.length < 4) return points;
    if (!endPoint) return points;

    const lastLeg = points[points.length - 2].distanceTo(endPoint);
    if (!isFinite(lastLeg) || lastLeg < 3) return points;

    const P = L.CRS.EPSG3857.project(endPoint);

    let bestD = Infinity;
    let bestPt: L.Point | null = null;
    let bestI = -1;

    const startI = Math.max(1, (points.length - 2) - window);
    const endI = Math.max(1, points.length - 3);

    for (let i = startI; i <= endI; i++) {
      const A = L.CRS.EPSG3857.project(points[i]);
      const B = L.CRS.EPSG3857.project(points[i + 1]);
      const res = this.closestPointOnSegmentMeters(P, A, B);
      if (res.dist < bestD) {
        bestD = res.dist;
        bestPt = res.pt;
        bestI = i;
      }
    }

    if (!bestPt || bestI < 1) return points;
    if (!isFinite(bestD) || bestD > maxSnapM) return points;

    const snapLL = L.CRS.EPSG3857.unproject(bestPt);

    const tail = points.slice(bestI);
    const oldTailDist = sumDistanceMeters(tail);

    const fromLL = points[bestI];
    const newTailDist = fromLL.distanceTo(snapLL) + snapLL.distanceTo(endPoint);

    const saved = oldTailDist - newTailDist;
    if (!isFinite(saved) || saved < minSaveM) return points;

    const out: L.LatLng[] = [];
    for (let k = 0; k <= bestI; k++) {
      const p = points[k];
      if (out.length === 0 || !this.almostSame(out[out.length - 1], p, 0.7)) out.push(p);
    }

    if (!this.almostSame(out[out.length - 1], snapLL, 0.8)) out.push(snapLL);
    if (!this.almostSame(out[out.length - 1], endPoint, 0.7)) out.push(endPoint);

    return out;
  }
}
