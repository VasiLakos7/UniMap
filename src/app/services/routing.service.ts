import { Injectable } from '@angular/core';
import * as L from 'leaflet';

@Injectable({ providedIn: 'root' })
export class RoutingService {
  private polyline: L.Polyline | null = null;

 
  async addRoute(
    map: L.Map,
    from: L.LatLng,
    to: L.LatLng,
    opts?: { fit?: boolean; padding?: [number, number] }
  ): Promise<void> {
    const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;

    this.removeRouting(map);

    const fit = opts?.fit !== false; 
    const padding = opts?.padding ?? [40, 40];

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (!data?.routes?.length) throw new Error('OSRM: No routes');

      const coords: [number, number][] = data.routes[0].geometry.coordinates;
      const latlngs = coords.map(([x, y]) => L.latLng(y, x));

      this.polyline = L.polyline(latlngs, { color: 'blue', weight: 5, opacity: 0.7 }).addTo(map);

      if (fit) {
        map.fitBounds(this.polyline.getBounds(), { padding });
      }
    } catch (err) {
      console.warn('OSRM error, fallback σε ευθεία γραμμή:', err);
      this.polyline = L.polyline([from, to], { weight: 4, dashArray: '10,10' }).addTo(map);

      if (fit) {
        map.fitBounds(this.polyline.getBounds(), { padding });
      }
    }
  }

  removeRouting(map: L.Map): void {
    if (this.polyline) {
      map.removeLayer(this.polyline);
      this.polyline = null;
    }
  }
}
