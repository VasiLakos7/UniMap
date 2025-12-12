import { Injectable, EventEmitter } from '@angular/core';
import * as L from 'leaflet';
import { Destination, destinationList } from '../models/destination.model';
import { CampusGraphService } from './campus-graph.service';
import { RoutingService } from './routing.service';

@Injectable({ providedIn: 'root' })
export class MapService {
  private map!: L.Map;
  private userMarker!: L.Marker;
  private destinationMarker: L.Marker | null = null;
  private startMarker: L.Marker | null = null;

  // Κύρια διαδρομή μπροστά (έντονη)
  private currentPolyline: L.Polyline | null = null;
  // Διαδρομή που έχεις ήδη περάσει (αχνή)
  private passedPolyline: L.Polyline | null = null;
  // Διακεκομμένη από start → πρώτο node
  private approachPolyline: L.Polyline | null = null;

  private baseLayer?: L.TileLayer;

  public locationFound = new EventEmitter<{ lat: number; lng: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();

  private busStop = L.latLng(40.657791, 22.802047);
  private destinationList = destinationList;

  // Για Simulation Mode (σημεία διαδρομής)
  public currentRoutePoints: L.LatLng[] = [];

  // 🔵 ΣΤΑΘΕΡΟ σημείο εκκίνησης για όλες τις διαδρομές
  private readonly fixedStartPoint = L.latLng(40.656115, 22.803626);

  // ------------------------------------------------------
  // FOLLOW MODE (να ακολουθεί τον χρήστη σε όλη τη διαδρομή)
  // ------------------------------------------------------
  private followUser = false;
  private followZoom: number | null = null;

  public setFollowUser(enabled: boolean, zoom?: number) {
    this.followUser = enabled;
    this.followZoom = typeof zoom === 'number' ? zoom : null;
  }

  // ------------------------------------------------------
  // ICONS
  // ------------------------------------------------------
  // ✅ divIcon ώστε να περιστρέφουμε ΜΟΝΟ την εικόνα (όχι όλο το marker)
  private userIcon = L.divIcon({
    className: 'user-marker',
    html: `<img class="user-arrow" src="assets/arrow.png" />`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  // Κόκκινο pin προορισμού
  private destIcon = L.icon({
    iconUrl: 'assets/icon/end-pin.png',
    iconSize: [45, 45],
    iconAnchor: [22, 45],
  });

  constructor(
    private graphService: CampusGraphService,
    private routingService: RoutingService,
  ) {}

  // ------------------------------------------------------
  // CAMPUS BOUNDARY
  // ------------------------------------------------------
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

  // ------------------------------------------------------
  // INITIALIZE MAP
  // ------------------------------------------------------
  initializeMap(lat: number, lng: number, elementId: string) {
    if (this.map) {
      this.map.off();
      this.map.remove();
    }

    this.map = L.map(elementId, {
      zoomControl: false,
      keyboard: true,
      maxZoom: 19, // ✅ για να μην πάει σε grey tiles
    }).setView([lat, lng], 18);

    this.setBaseLayer('maptiler-osm', 'fFUNZQgQLPQX2iZWUJ8w');

    this.setupUserLocation(lat, lng);
    this.setupMapClickEvent();
  }

  // ✅ Zoom/center helper
  public focusOn(lat: number, lng: number, zoom: number = 19) {
    if (!this.map) return;
    this.map.flyTo([lat, lng], zoom, { animate: true, duration: 0.7 });
  }

  // ✅ Περιστροφή βελακιού χρήστη (deg 0-360)
  public setUserHeading(deg: number) {
    if (!this.userMarker) return;
    const el = this.userMarker.getElement();
    if (!el) return;

    const img = el.querySelector('img.user-arrow') as HTMLImageElement | null;
    if (!img) return;

    img.style.transformOrigin = '50% 50%';
    img.style.transform = `rotate(${deg}deg)`;
  }

  // ------------------------------------------------------
  // BASE LAYER
  // ------------------------------------------------------
  private setBaseLayer(
    style: 'osm' | 'positron' | 'dark' | 'maptiler-outdoor' | 'maptiler-osm',
    apiKey?: string
  ) {
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

  // ------------------------------------------------------
  // USER LOCATION (GPS για εμφάνιση)
  // ------------------------------------------------------
  private setupUserLocation(lat: number, lng: number) {
    this.userMarker = L.marker([lat, lng], { icon: this.userIcon })
      .addTo(this.map)
      .bindPopup('Η θέση σου 📍');

    this.map.locate({
      setView: false,
      maxZoom: 18,
      watch: false,
    });

    this.map.on('locationfound', (e: L.LocationEvent) => {
      const { lat: nlat, lng: nlng } = e.latlng;

      this.userMarker.setLatLng([nlat, nlng]);
      this.locationFound.emit({ lat: nlat, lng: nlng });

      // αν δεν είμαστε σε follow mode, κράτα ένα ελαφρύ view update
      if (!this.followUser) {
        this.map.setView([nlat, nlng], 18);
      }
    });

    this.map.on('locationerror', () => {
      this.locationError.emit();
    });
  }

  // ------------------------------------------------------
  // MAP CLICK
  // ------------------------------------------------------
  private setupMapClickEvent() {
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

  // ------------------------------------------------------
  // PIN DESTINATION
  // ------------------------------------------------------
  public pinDestination(lat: number, lng: number, label?: string) {
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

  // ------------------------------------------------------
  // ROUTE προς Destination – από fixedStartPoint
  // ------------------------------------------------------
  public async drawCustomRouteToDestination(dest: Destination) {
    const startPoint = this.fixedStartPoint;

    // καθάρισε παλιές γραμμές (όχι το pin)
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
    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }
    if (this.map) {
      this.routingService.removeRouting(this.map);
    }

    const destLat = dest.entranceLat ?? dest.lat;
    const destLng = dest.entranceLng ?? dest.lng;

    const endNodeId = this.graphService.findNearestNodeId(destLat, destLng);
    if (!endNodeId) {
      console.warn('No graph node found near destination entrance:', dest.name);
      return;
    }

    const nearestToStartId = this.graphService.findNearestNodeId(
      startPoint.lat,
      startPoint.lng
    );
    let startNodeId: string | null = nearestToStartId;

    if (!startNodeId) {
      startNodeId = this.graphService.findBestStartNodeForDestination(
        startPoint.lat,
        startPoint.lng,
        endNodeId
      );
    }

    if (!startNodeId) {
      console.warn('No graph node found near fixed start point');
      return;
    }

    const pathNodes = this.graphService.calculatePath(startNodeId, endNodeId);
    if (!pathNodes || pathNodes.length < 1) {
      console.warn('No path between nodes:', startNodeId, '→', endNodeId);
      return;
    }

    const startNodeCoords = this.graphService.getDestinationCoords(startNodeId)!;
    const mainRoutePoints: L.LatLng[] = [...pathNodes];

    // Σημεία για simulation
    this.currentRoutePoints = [startPoint, startNodeCoords, ...mainRoutePoints];

    // Διακεκομμένη από fixed start → πρώτο node
    if (startPoint.distanceTo(startNodeCoords) > 1) {
      this.approachPolyline = L.polyline([startPoint, startNodeCoords], {
        color: '#666666',
        weight: 3,
        opacity: 0.7,
        dashArray: '4 8',
      }).addTo(this.map);
    }

    // Κύρια μπλε γραμμή (μπροστά)
    this.currentPolyline = L.polyline(mainRoutePoints, {
      color: '#007bff',
      weight: 6,
      opacity: 0.9,
    }).addTo(this.map);

    // αρχικά δεν έχεις περάσει από πουθενά
    if (this.passedPolyline) {
      this.map.removeLayer(this.passedPolyline);
      this.passedPolyline = null;
    }

    const allPoints = [startPoint, startNodeCoords, ...mainRoutePoints];
    const bounds = L.latLngBounds(allPoints);
    this.map.fitBounds(bounds, { padding: [50, 50] });
  }

  // ------------------------------------------------------
  // ΕΝΗΜΕΡΩΣΗ διαδρομής: πίσω (αχνό) & μπροστά (έντονο)
  // ------------------------------------------------------
  public updateRouteProgress(passedPoints: L.LatLng[], remainingPoints: L.LatLng[]) {
    if (!this.map) return;

    // γραμμή ΠΙΣΩ (αχνή)
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

    // γραμμή ΜΠΡΟΣΤΑ (έντονη)
    if (remainingPoints && remainingPoints.length >= 2) {
      if (!this.currentPolyline) {
        this.currentPolyline = L.polyline(remainingPoints, {
          color: '#007bff',
          weight: 6,
          opacity: 0.9,
        }).addTo(this.map);
      } else {
        this.currentPolyline.setLatLngs(remainingPoints);
      }
    } else {
      if (this.currentPolyline) {
        this.map.removeLayer(this.currentPolyline);
        this.currentPolyline = null;
      }
    }
  }

  // ------------------------------------------------------
  // TOOLS
  // ------------------------------------------------------
  public removeRouting() {
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

    if (this.destinationMarker) {
      this.map.removeLayer(this.destinationMarker);
      this.destinationMarker = null;
    }

    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }

    if (this.map) {
      this.routingService.removeRouting(this.map);
    }

    this.currentRoutePoints = [];
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.currentRoutePoints;
  }

  // ✅ εδώ πλέον ακολουθεί ΚΑΙ το map όταν followUser = true
  public updateUserPosition(lat: number, lng: number) {
    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    }

    if (this.map && this.followUser) {
      const z = this.followZoom ?? this.map.getZoom();
      this.map.panTo([lat, lng], { animate: true, duration: 0.5 });
      if (this.map.getZoom() !== z) this.map.setZoom(z);
    }
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  public getBusStopLocation(): L.LatLng {
    return this.busStop;
  }
}
