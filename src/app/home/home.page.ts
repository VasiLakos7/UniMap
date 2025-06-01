import { Component, OnInit } from '@angular/core';
import * as L from 'leaflet';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {
  map: any;

  ngOnInit() {
    this.loadMap();
  }

  loadMap() {
    this.map = L.map('map').setView([40.657230, 22.804656], 17);
    this.map.on('click', this.onMapClick.bind(this));


    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);
  }

  startMarker: any;
endMarker: any;

onMapClick(e: L.LeafletMouseEvent) {
  if (!this.startMarker) {
    this.startMarker = L.marker(e.latlng).addTo(this.map).bindPopup("Start").openPopup();
  } else if (!this.endMarker) {
    this.endMarker = L.marker(e.latlng).addTo(this.map).bindPopup("End").openPopup();
    this.drawRoute();
  }
}
async drawRoute() {
  const start = this.startMarker.getLatLng();
  const end = this.endMarker.getLatLng();

  const response = await fetch('https://api.openrouteservice.org/v2/directions/foot-walking?api_key=YOUR_API_KEY', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [[start.lng, start.lat], [end.lng, end.lat]]
    })
  });

  const data = await response.json();
  const coords = data.features[0].geometry.coordinates.map((c: any) => [c[1], c[0]]);

  L.polyline(coords, { color: 'blue' }).addTo(this.map);
}


}
