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

  // Κύρια διαδρομή πάνω στο γράφημα
  private currentPolyline: L.Polyline | null = null;
  // Διακεκομμένη από user → start node
  private approachPolyline: L.Polyline | null = null;

  private baseLayer?: L.TileLayer;

  public locationFound = new EventEmitter<{ lat: number; lng: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();

  private busStop = L.latLng(40.657791, 22.802047);
  private destinationList = destinationList;

  // Για Simulation Mode
  public currentRoutePoints: L.LatLng[] = [];

  // ------------------------------------------------------
  // ICONS
  // ------------------------------------------------------
  private userIcon = L.icon({
    iconUrl: 'assets/arrow.png',
    iconSize: [25, 25],
    iconAnchor: [12, 12],
  });

  private destIcon = L.icon({
    iconUrl: 'assets/destination-pin.png',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
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
    }).setView([lat, lng], 18);

    this.setBaseLayer('maptiler-osm', 'fFUNZQgQLPQX2iZWUJ8w');

    this.setupUserLocation(lat, lng);
    this.setupMapClickEvent();
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
        opt: { attribution: '© OpenStreetMap | © MapTiler', tileSize: 512, zoomOffset: -1 },
      },
      'maptiler-osm': {
        url: `https://api.maptiler.com/maps/openstreetmap/{z}/{x}/{y}.png?key=${apiKey ?? ''}`,
        opt: { attribution: '© OpenStreetMap | © MapTiler', tileSize: 512, zoomOffset: -1 },
      },
    };

    this.baseLayer = L.tileLayer(layers[style].url, layers[style].opt).addTo(this.map);
  }

  // ------------------------------------------------------
  // USER LOCATION
  // ------------------------------------------------------
  private setupUserLocation(lat: number, lng: number) {
    this.userMarker = L.marker([lat, lng], { icon: this.userIcon })
      .addTo(this.map)
      .bindPopup('Η θέση σου 📍');

    this.map.locate({ setView: false, maxZoom: 18, watch: true });

    this.map.on('locationfound', (e: L.LocationEvent) => {
      const { lat, lng } = e.latlng;
      this.userMarker.setLatLng([lat, lng]);
      this.locationFound.emit({ lat, lng });
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
  // PIN DESTINATION (πινέζα στην είσοδο / κέντρο)
  // ------------------------------------------------------
  public pinDestination(lat: number, lng: number) {
    this.removeRouting();

    const to = L.latLng(lat, lng);

    if (this.destinationMarker) this.map.removeLayer(this.destinationMarker);
    if (this.startMarker) this.map.removeLayer(this.startMarker);

    this.destinationMarker = L.marker(to, { icon: this.destIcon }).addTo(this.map);
    this.map.setView(to, 18);
  }

  // ------------------------------------------------------
  // ROUTE προς συγκεκριμένο Destination
  // ------------------------------------------------------
  public async drawCustomRouteToDestination(startPoint: L.LatLng, dest: Destination) {
    this.removeRouting();

    // 1. Συντεταγμένες εισόδου τμήματος
    const destLat = dest.entranceLat ?? dest.lat;
    const destLng = dest.entranceLng ?? dest.lng;

    // 2. Κόμβος ΠΡΟΟΡΙΣΜΟΥ: κοντινότερος στο entrance
    const endNodeId = this.graphService.findNearestNodeId(destLat, destLng);
    if (!endNodeId) {
      console.warn('No graph node found near destination entrance:', dest.name);
      return;
    }

    // 3.1 Πλησιέστερος κόμβος στον χρήστη
    const nearestToUserId = this.graphService.findNearestNodeId(
      startPoint.lat,
      startPoint.lng
    );

    let startNodeId: string | null = null;

    if (nearestToUserId) {
      const nearestCoords = this.graphService.getDestinationCoords(nearestToUserId)!;
      const distUserToNearest = startPoint.distanceTo(nearestCoords);

      // Αν ο χρήστης είναι κοντά στο δίκτυο (< 40 m),
      // ξεκινάμε ΠΑΝΤΑ από τον κοντινότερο κόμβο για να μην κάνει
      // άσχημα "πάνω-κάτω".
      if (distUserToNearest < 40) {
        startNodeId = nearestToUserId;
      }
    }

    // 3.2 Αν δεν είμαστε κοντά σε κανέναν κόμβο,
    // χρησιμοποιούμε τον "έξυπνο" βέλτιστο start node
    if (!startNodeId) {
      startNodeId = this.graphService.findBestStartNodeForDestination(
        startPoint.lat,
        startPoint.lng,
        endNodeId
      );
    }

    // 3.3 Τελικό fallback
    if (!startNodeId && nearestToUserId) {
      startNodeId = nearestToUserId;
    }

    if (!startNodeId) {
      console.warn('No graph node found near user start point');
      return;
    }

    // 4. Υπολογίζουμε διαδρομή πάνω στο γράφημα: startNodeId → endNodeId
    const pathNodes = this.graphService.calculatePath(startNodeId, endNodeId);
    if (!pathNodes || pathNodes.length < 1) {
      console.warn('No path between nodes:', startNodeId, '→', endNodeId);
      return;
    }

    const startNodeCoords = this.graphService.getDestinationCoords(startNodeId)!;

    const mainRoutePoints: L.LatLng[] = [...pathNodes];

    // 5. Σημεία για simulation: user → startNode → ... → endNode
    this.currentRoutePoints = [startPoint, startNodeCoords, ...mainRoutePoints];

    // 6. Διακεκομμένη γραμμή user → startNode
    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }

    if (startPoint.distanceTo(startNodeCoords) > 1) {
      this.approachPolyline = L.polyline([startPoint, startNodeCoords], {
        color: '#CC0000',
        weight: 3,
        opacity: 0.7,
        dashArray: '4 8',
      }).addTo(this.map);
    }

    // 7. Κύρια κόκκινη διαδρομή πάνω στο γράφημα
    if (this.currentPolyline) {
      this.map.removeLayer(this.currentPolyline);
      this.currentPolyline = null;
    }

    this.currentPolyline = L.polyline(mainRoutePoints, {
      color: '#CC0000',
      weight: 6,
      opacity: 0.9,
    }).addTo(this.map);

    const allPoints = [startPoint, startNodeCoords, ...mainRoutePoints];
    const bounds = L.latLngBounds(allPoints);
    this.map.fitBounds(bounds, { padding: [50, 50] });
  }

  // Προαιρετικό wrapper αν κάπου αλλού καλείς με name string
  public async drawCustomRoute(startPoint: L.LatLng, destinationName: string) {
    const dest = this.destinationList.find(d => d.name === destinationName);
    if (!dest) {
      console.warn('Destination not found in destinationList:', destinationName);
      return;
    }
    return this.drawCustomRouteToDestination(startPoint, dest);
  }

  // ------------------------------------------------------
  // TOOLS
  // ------------------------------------------------------
  public removeRouting() {
    if (this.currentPolyline) {
      this.map.removeLayer(this.currentPolyline);
      this.currentPolyline = null;
    }

    if (this.approachPolyline) {
      this.map.removeLayer(this.approachPolyline);
      this.approachPolyline = null;
    }

    if (this.destinationMarker) this.map.removeLayer(this.destinationMarker);
    if (this.startMarker) this.map.removeLayer(this.startMarker);

    if (this.map) this.routingService.removeRouting(this.map);
  }

  public getCurrentRoutePoints(): L.LatLng[] {
    return this.currentRoutePoints;
  }

  public updateUserPosition(lat: number, lng: number) {
    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
    }
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lat1).distanceTo(L.latLng(lat2, lng2));
  }

  public getBusStopLocation(): L.LatLng {
    return this.busStop;
  }
}
