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
  imports: [IonicModule, CommonModule, FormsModule],
})
export class HomePage implements OnInit {
  map: any;
  userLat = 40.657230;
  userLng = 22.804656;

  searchQuery = '';
  filteredResults: string[] = [];
  distanceInMeters: number | null = null;

  destinationList: { name: string, lat: number, lng: number }[] = [
    { name: 'Τμήμα Νοσηλευτικής', lat: 40.6575, lng: 22.8052 },
    { name: 'Τμήμα Μαιευτικής', lat: 40.6579, lng: 22.8041 },
    { name: 'Τμήμα Ηλεκτρονικών', lat: 40.6568, lng: 22.8035 },
    { name: 'Κεντρική Πύλη', lat: 40.6564, lng: 22.8028 },
    { name: 'Βιβλιοθήκη', lat: 40.6581, lng: 22.8049 },
  ];

  routeLayer: any;
  currentDestination: { name: string; lat: number; lng: number } | null = null;

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
    this.map = L.map('map').setView([this.userLat, this.userLng], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
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
  }

  onSearchInput() {
    const query = this.searchQuery.toLowerCase();
    this.filteredResults = this.destinationList
      .filter((dest) => dest.name.toLowerCase().includes(query))
      .map((dest) => dest.name);
  }

  selectDestination(destName: string) {
    const dest = this.destinationList.find((d) => d.name === destName);
    if (!dest) return;

    this.currentDestination = dest;

    // Υπολογισμός ευθείας απόστασης
    this.distanceInMeters = this.calculateDistance(
      this.userLat,
      this.userLng,
      dest.lat,
      dest.lng
    );

    // Εμφάνιση μαρκαδόρου
    const icon = L.icon({
      iconUrl: 'assets/destination-pin.png',
      iconSize: [30, 30],
      iconAnchor: [15, 30],
    });

    L.marker([dest.lat, dest.lng], { icon })
      .addTo(this.map)
      .bindPopup(`Προορισμός: ${dest.name}`)
      .openPopup();

    const bounds = L.latLngBounds([
      [this.userLat, this.userLng],
      [dest.lat, dest.lng],
    ]);
    this.map.fitBounds(bounds, { padding: [50, 50] });

    this.filteredResults = [];
    this.searchQuery = dest.name;
  }

  calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371000; // σε μέτρα
    const toRad = (deg: number) => deg * (Math.PI / 180);

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  async startNavigation() {
    const alert = await this.alertCtrl.create({
      header: 'Έναρξη Πλοήγησης',
      message: `Ξεκινά η πλοήγηση προς <strong>${this.currentDestination?.name}</strong>`,
      buttons: ['ΟΚ'],
    });

    await alert.present();
  }
}
