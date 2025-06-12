import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../services/routing.service';
import { Destination } from '../models/destination.model';
import { SearchBarComponent } from '../components/search-bar/search-bar.component';
import { DestinationPanelComponent } from '../components/destination-panel/destination-panel.component';
import { destinationList } from '../models/destination.model';


@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [IonicModule, CommonModule, FormsModule, SearchBarComponent, DestinationPanelComponent],
})
export class HomePage implements OnInit {
  map!: L.Map;
  destinationMarker: L.Marker | null = null;

  userLat = 40.657230;
  userLng = 22.804656;

  centralGate = L.latLng(40.6564, 22.8028);
  busStop = L.latLng(40.657791, 22.802047);

  searchQuery = '';
  filteredResults: string[] = [];
  distanceInMeters = 0;

  currentDestination: Destination | null = null;

  destinationList = destinationList;



  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private routingService: RoutingService
  ) {}

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
    this.map = L.map('map').setView([40.6572, 22.8046], 18);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    const userIcon = L.icon({
      iconUrl: 'assets/arrow.png',
      iconSize: [25, 25],
      iconAnchor: [12, 12],
      popupAnchor: [0, -10]
    });

    L.marker([this.userLat, this.userLng], { icon: userIcon })
      .addTo(this.map)
      .bindPopup('Η θέση σου 📍')
      .openPopup();

    // ✅ Ελεγχος click για bounds χωρίς να προσθέσουμε rectangle στο χάρτη
    this.map.on('click', (e: any) => {
      const latlng = e.latlng;
      const clickedLat = latlng.lat;
      const clickedLng = latlng.lng;

      const found = this.destinationList.find((dest: Destination) =>
 {
  const b = dest.bounds;
  if (!b) return false;
  return (
    clickedLat >= b.south &&
    clickedLat <= b.north &&
    clickedLng >= b.west &&
    clickedLng <= b.east
  );
});


      if (found) {
        this.handleMapClick(found.lat, found.lng, found.name);
      } else {
        this.handleMapClick(clickedLat, clickedLng);
      }
    });
  }

  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  async selectDestination(name: string) {
    const dest = this.destinationList.find((d: Destination) => d.name === name);
    if (!dest) return;
    this.handleMapClick(dest.lat, dest.lng, dest.name);
  }

  onDestinationSelected(destination: Destination) {
    this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    this.currentDestination = { name, lat, lng };

    const from = L.latLng(this.userLat, this.userLng);
    const to = L.latLng(lat, lng);

    const distance = from.distanceTo(to);
    this.distanceInMeters = distance;

    const isFar = distance > 300;
    const startPoint = isFar ? this.busStop : from;

    this.routingService.removeRouting(this.map);
    if (this.destinationMarker) {
      this.map.removeLayer(this.destinationMarker);
    }

    const destIcon = L.icon({
      iconUrl: 'assets/destination-pin.png',
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
    this.destinationMarker = L.marker(to, { icon: destIcon }).addTo(this.map);

    const startIcon = L.icon({
      iconUrl: 'assets/arrow.png',
      iconSize: [25, 25],
      iconAnchor: [12, 12]
    });
    L.marker(startPoint, { icon: startIcon })
      .addTo(this.map)
      .bindPopup('Αφετηρία 🚏')
      .openPopup();

    if (isFar) {
      const alert = await this.alertCtrl.create({
        header: 'Εκτός εμβέλειας',
        message: 'Είστε εκτός εμβέλειας πανεπιστημιούπολης. Η διαδρομή ξεκινά από τη στάση του ΟΑΣΘ.',
        buttons: ['ΟΚ']
      });
      await alert.present();
    }

    await this.routingService.addRoute(this.map, startPoint, to);
  }

  async startNavigation() {
    if (!this.currentDestination) return;

    const alert = await this.alertCtrl.create({
      header: 'Πλοήγηση',
      message: `Έναρξη πλοήγησης προς ${this.currentDestination.name}`,
      buttons: ['OK']
    });

    await alert.present();
  }
}
