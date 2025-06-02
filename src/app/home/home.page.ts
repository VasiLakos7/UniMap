import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule]
})
export class HomePage implements OnInit {
  map: any;
  userLat = 40.657230;
  userLng = 22.804656;
  searchQuery = '';
  filteredResults: string[] = [];
  currentDestination: { name: string, lat: number, lng: number } | null = null;
  destinationMarker: any;
  distanceInMeters: number = 0;
  routeLayer: any;

  destinationList = [
    { name: 'Τμήμα Νοσηλευτικής', lat: 40.6575, lng: 22.8052 },
    { name: 'Τμήμα Μαιευτικής', lat: 40.6579, lng: 22.8041 },
    { name: 'Τμήμα Ηλεκτρονικών', lat: 40.6568, lng: 22.8035 },
    { name: 'Κεντρική Πύλη', lat: 40.6564, lng: 22.8028 }
  ];

  constructor(private router: Router, private alertCtrl: AlertController) {}

  ngOnInit() {
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state) {
      this.userLat = nav.extras.state['lat'] ?? this.userLat;
      this.userLng = nav.extras.state['lng'] ?? this.userLng;
    }
  }

  ionViewDidEnter() {
    this.loadMap();
  }

  loadMap() {
    this.map = L.map('map', { zoomControl: true }).setView([this.userLat, this.userLng], 18);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 22
    }).addTo(this.map);

    const userIcon = L.icon({
      iconUrl: 'assets/arrow.png',
      iconSize: [25, 25],
      iconAnchor: [12, 12],
      popupAnchor: [0, -10],
    });

    L.marker([this.userLat, this.userLng], { icon: userIcon })
      .addTo(this.map)
      .bindPopup('Η θέση σου 📍')
      .openPopup();

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.setDestination('Επιλογή Χάρτη', e.latlng.lat, e.latlng.lng);
    });
  }

  onSearchInput() {
    const normalize = (str: string) =>
      str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const query = normalize(this.searchQuery);
    this.filteredResults = this.destinationList
      .filter(d => normalize(d.name).includes(query))
      .map(d => d.name);
  }

  selectDestination(name: string) {
    const dest = this.destinationList.find(d =>
      d.name.toLowerCase() === name.toLowerCase()
    );
    if (!dest) return;
    this.setDestination(dest.name, dest.lat, dest.lng);
    this.filteredResults = [];
    this.searchQuery = dest.name;
  }

  setDestination(name: string, lat: number, lng: number) {
    this.currentDestination = { name, lat, lng };

    if (this.destinationMarker) this.map.removeLayer(this.destinationMarker);
    const icon = L.icon({
      iconUrl: 'assets/destination-pin.png',
      iconSize: [35, 35],
      iconAnchor: [17, 34],
    });

    this.destinationMarker = L.marker([lat, lng], { icon }).addTo(this.map)
      .bindPopup(`Προορισμός: ${name}`)
      .openPopup();

    this.distanceInMeters = Math.round(this.map.distance(
      [this.userLat, this.userLng],
      [lat, lng]
    ));
  }

  startNavigation() {
    if (!this.currentDestination) return;
    alert(`Ξεκινά η πλοήγηση προς ${this.currentDestination.name}`);
  }
}
