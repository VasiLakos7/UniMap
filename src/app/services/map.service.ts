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
  private currentPolyline: L.Polyline | null = null;
  private baseLayer?: L.TileLayer;

  public locationFound = new EventEmitter<{ lat: number; lng: number }>();
  public mapClicked = new EventEmitter<{ lat: number; lng: number; name: string | null }>();
  public locationError = new EventEmitter<void>();

  private busStop = L.latLng(40.657791, 22.802047);
  private destinationList = destinationList;

  // ------------------------------------------------------
  // USER & DESTINATION ICONS
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
  // CAMPUS BOUNDARY (NO PIN OUTSIDE)
  // ------------------------------------------------------
  private campusBoundary = L.polygon([
    [40.659484, 22.801706],  // Top Left
    [40.659338, 22.806507],  // Top Right
    [40.654901, 22.806625],  // Bottom Right
    [40.655500, 22.801840],  // Bottom Left
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
  // MAP CLICK - WITH CAMPUS CHECK
  // ------------------------------------------------------
  private setupMapClickEvent() {
    this.map.on('click', async (e: L.LeafletMouseEvent) => {
      const clickedLat = e.latlng.lat;
      const clickedLng = e.latlng.lng;

      // ❌ OUTSIDE CAMPUS → show toast + stop
      if (!this.isInsideCampus(clickedLat, clickedLng)) {
        await this.presentToast("Αυτό το σημείο είναι εκτός campus. Παρακαλώ επίλεξε άλλο.");
        return;
      }

      // ✔️ IN CAMPUS → check bounds from destinationList
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
  public pinDestination(lat: number, lng: number) {
    this.removeRouting();

    const to = L.latLng(lat, lng);

    if (this.destinationMarker) this.map.removeLayer(this.destinationMarker);
    if (this.startMarker) this.map.removeLayer(this.startMarker);

    this.destinationMarker = L.marker(to, { icon: this.destIcon }).addTo(this.map);
    this.map.setView(to, 18);
  }

  // ------------------------------------------------------
  // CUSTOM ROUTE (Dijkstra)
  // ------------------------------------------------------
 public async drawCustomRoute(startPoint: L.LatLng, destinationName: string) {
  this.removeRouting();

  // 1. Πάρε τον προορισμό
  const endNodeId = this.graphService.getNodeIdForName(destinationName);
  if (!endNodeId) {
    console.warn("Destination not found:", destinationName);
    return;
  }

  // 2. Βρες τον κοντινότερο κόμβο στο χρήστη
  const nearestStartId = this.graphService.findNearestNodeId(startPoint.lat, startPoint.lng);
  const nearestStartPoint = nearestStartId
    ? this.graphService.getDestinationCoords(nearestStartId)!
    : null;

  // 3. BUS STOP κόμβος
  const busNodeId = 'BS_1';
  const busPoint = this.graphService.getDestinationCoords(busNodeId)!;

  // 4. Αν ο χρήστης είναι μακριά -> χρησιμοποιούμε BS_1
  let startNodeId: string = nearestStartId!;
  const distanceToCampus = nearestStartPoint
    ? startPoint.distanceTo(nearestStartPoint)
    : Infinity;

  if (distanceToCampus > 50 || !nearestStartId) {
    startNodeId = busNodeId;
    await this.presentToast("Βρίσκεσαι εκτός campus — ξεκινάω από τη στάση λεωφορείου.");
  }

  // 5. Βρες διαδρομή Dijkstra
  const path = this.graphService.calculatePath(startNodeId, endNodeId);
  if (!path) {
    console.warn("No path from:", startNodeId, "to:", endNodeId);
    return;
  }

  // 6. Ζωγράφισε την καινούργια διαδρομή
  this.currentPolyline = L.polyline(path, {
    color: '#CC0000',
    weight: 6,
    opacity: 0.9
  }).addTo(this.map);

  // 7. Zoom σωστά
  this.map.fitBounds(this.currentPolyline.getBounds(), { padding: [50, 50] });
}




  // ------------------------------------------------------
  // TOOLS
  // ------------------------------------------------------
  public removeRouting() {
    if (this.currentPolyline) {
      this.map.removeLayer(this.currentPolyline);
      this.currentPolyline = null;
    }

    if (this.destinationMarker) this.map.removeLayer(this.destinationMarker);
    if (this.startMarker) this.map.removeLayer(this.startMarker);

    if (this.map) this.routingService.removeRouting(this.map);
  }

  public getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
  }

  public getBusStopLocation(): L.LatLng {
    return this.busStop;
  }
}
