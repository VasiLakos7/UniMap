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

  destinationList: Destination[] = [
    {
      name: 'Τμήμα Μαιευτικής',
      lat: 40.6579, lng: 22.8041,
      bounds: { north: 40.65812, south: 40.65760, east: 22.80500, west: 22.80420 }
    },
    {
      name: 'Τμήμα Νοσηλευτικής',
      lat: 40.6575, lng: 22.8052,
      bounds: { north: 40.65790, south: 40.65730, east: 22.80420, west: 22.80340 }
    },
    {
      name: 'Τμήμα Διατροφής και Διαιτολογίας',
      lat: 40.6579, lng: 22.8035,
      bounds: { north: 40.65810, south: 40.65770, east: 22.80380, west: 22.80320 }
    },
    {
      name: 'Τμήμα Ζωικής Παραγωγής',
      lat: 40.6582, lng: 22.8037,
      bounds: { north: 40.65835, south: 40.65805, east: 22.80390, west: 22.80350 }
    },
    {
      name: 'Τμήμα Επιστήμης και Τεχνολογίας Τροφίμων',
      lat: 40.6567, lng: 22.7997,
      bounds: { north: 40.65700, south: 40.65650, east: 22.80000, west: 22.79930 }
    },
    {
      name: 'Τμήμα Μηχανικών Παραγωγής και Διοίκησης',
      lat: 40.6583, lng: 22.8007,
      bounds: { north: 40.65850, south: 40.65810, east: 22.80100, west: 22.80020 }
    },
    {
      name: 'Παράρτημα Οχημάτων',
      lat: 40.6563, lng: 22.7985,
      bounds: { north: 40.65660, south: 40.65600, east: 22.79890, west: 22.79810 }
    },
    {
      name: 'Κτήριο Ηλεκτρονικής',
      lat: 40.6582, lng: 22.8073,
      bounds: { north: 40.65845, south: 40.65800, east: 22.80760, west: 22.80700 }
    },
    {
      name: 'ΣΔΟ',
      lat: 40.65815, lng: 22.8025,
      bounds: { north: 40.65825, south: 40.65805, east: 22.8027, west: 22.8023 }
    },
    {
      name: 'Φοιτητικές Εστίες',
      lat: 40.6580, lng: 22.8045,
      bounds: { north: 40.65830, south: 40.65780, east: 22.80470, west: 22.80420 }
    },
    {
      name: 'Βιβλιοθήκη',
      lat: 40.6573, lng: 22.8012,
      bounds: { north: 40.65745, south: 40.65715, east: 22.8015, west: 22.8009 }
    },
    {
      name: 'Τμήμα Μηχανικών Πληροφορικής (Κτήριο Π)',
      lat: 40.6578, lng: 22.8010,
      bounds: { north: 40.65800, south: 40.65760, east: 22.80130, west: 22.80070 }
    },
    {
      name: 'Κυλικείο',
      lat: 40.6575, lng: 22.8016,
      bounds: { north: 40.65765, south: 40.65740, east: 22.8018, west: 22.8014 }
    },
    {
      name: 'Ιατρείο',
      lat: 40.6569, lng: 22.8021,
      bounds: { north: 40.65705, south: 40.65685, east: 22.8023, west: 22.8019 }
    },
    {
      name: 'Διοίκηση',
      lat: 40.6566, lng: 22.8031,
      bounds: { north: 40.65675, south: 40.65650, east: 22.8033, west: 22.8029 }
    }
  ];

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

    this.map.on('click', (e: any) => {
      const latlng = e.latlng;
      this.handleMapClick(latlng.lat, latlng.lng);
    });

    // ✅ Προσθήκη ορίων για τα τμήματα
    this.destinationList.forEach(dest => {
      if (dest.bounds) {
        const b = dest.bounds;
        const rectangle = L.rectangle([
          [b.south, b.west],
          [b.north, b.east]
        ], {
          color: 'orange',
          weight: 2,
          fillOpacity: 0.1
        });

        rectangle.addTo(this.map)
          .bindPopup(dest.name)
          .on('click', () => {
            this.handleMapClick(dest.lat, dest.lng, dest.name);
          });
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
    const dest = this.destinationList.find(d => d.name === name);
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
