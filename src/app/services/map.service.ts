import * as L from 'leaflet';

export class MapService {
  private map!: L.Map;

  initMap(containerId: string, center: L.LatLngExpression, zoom: number): L.Map {
    this.map = L.map(containerId).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    return this.map;
  }

  addUserMarker(lat: number, lng: number): void {
    const userIcon = L.icon({
      iconUrl: 'assets/arrow.png',
      iconSize: [25, 25],
      iconAnchor: [12, 12],
      popupAnchor: [0, -10]
    });

    L.marker([lat, lng], { icon: userIcon })
      .addTo(this.map)
      .bindPopup('Η θέση σου 📍')
      .openPopup();
  }

  onMapClick(callback: (lat: number, lng: number) => void): void {
    this.map.on('click', (e: any) => {
      const latlng = e.latlng;
      callback(latlng.lat, latlng.lng);
    });
  }

  getMap(): L.Map {
    return this.map;
  }
}
