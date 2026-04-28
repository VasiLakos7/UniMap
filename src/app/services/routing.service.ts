import { Injectable } from '@angular/core';
import * as L from 'leaflet';

@Injectable({ providedIn: 'root' })
export class RoutingService {
  private polyline: L.Polyline | null = null;

  removeRouting(map: L.Map): void {
    if (this.polyline) {
      map.removeLayer(this.polyline);
      this.polyline = null;
    }
  }
}
