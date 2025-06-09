import { Injectable } from '@angular/core';
import * as L from 'leaflet';

@Injectable({
  providedIn: 'root' // ✅ Επιτρέπει στο Angular να τον παρέχει παντού
})
export class RoutingService {
  private polyline: L.Polyline | null = null;

  async addRoute(map: L.Map, from: L.LatLng, to: L.LatLng): Promise<void> {
    const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      const coords = data.routes[0].geometry.coordinates;
      const latlngs = coords.map((coord: number[]) => L.latLng(coord[1], coord[0]));

      this.polyline = L.polyline(latlngs, {
        color: 'blue',
        weight: 5,
        opacity: 0.7
      }).addTo(map);

      // (προαιρετικά για turn-by-turn βήματα)
      // const steps = data.routes[0].legs[0].steps;
      // console.log(steps);
    } catch (err) {
      console.error('Routing error:', err);
    }
  }

  removeRouting(map: L.Map): void {
    if (this.polyline) {
      map.removeLayer(this.polyline);
      this.polyline = null;
    }
  }
}
