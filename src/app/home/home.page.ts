import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet'; 
import { AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Destination, destinationList } from '../models/destination.model';
import { MapService } from '../services/map.service'; 
import { SearchBarComponent } from '../components/search-bar/search-bar.component';
import { DepartmentPopupComponent } from '../components/department-popup/department-popup.component';
import { Subscription } from 'rxjs'; 
import { App } from '@capacitor/app'; 


@Component({
  standalone: true,
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    SearchBarComponent,
    DepartmentPopupComponent 
  ],
})
export class HomePage implements OnInit, OnDestroy {
  // ΘΕΣΕΙΣ (διατηρούνται εδώ ως state)
  userLat = 40.657230;
  userLng = 22.804656;
  
  // UI / State
  distanceInMeters = 0;
  currentDestination: Destination | null = null;
  showModal: boolean = false;
  showLockOverlay: boolean = false; 
  destinationList = destinationList;

  private mapSubscriptions: Subscription[] = [];
  
  // Σταθερές
  private defaultStartPoint = L.latLng(this.userLat, this.userLng);
  private readonly campusBounds = {
    north: 40.66000, 
    south: 40.65400, 
    east: 22.80800,  
    west: 22.79800,  
  };

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private mapService: MapService 
  ) {}

  ngOnInit() {
    const nav = this.router.getCurrentNavigation();
    if (nav?.extras?.state) {
      this.userLat = nav.extras.state['lat'] ?? this.userLat;
      this.userLng = nav.extras.state['lng'] ?? this.userLng;
    }
    this.subscribeToMapEvents();
  }
  
  ngOnDestroy() {
    this.mapSubscriptions.forEach(sub => sub.unsubscribe());
  }

  ionViewDidEnter() {
    this.mapService.initializeMap(this.userLat, this.userLng, 'map');
  }

  // =======================================================
  // 1. ΕΛΕΓΧΟΣ ΟΡΙΩΝ / ΕΞΟΔΟΣ
  // =======================================================

  /**
   * 🛑 ΠΡΟΣΩΡΙΝΗ ΠΑΡΑΚΑΜΨΗ (TESTING MODE)
   * Επιστρέφει πάντα true για να επιτρέψει τη χρήση του χάρτη σε desktop/emulator.
   */
  private isLocationWithinCampus(lat: number, lng: number): boolean {
    return true; 
  }

  private handleOutsideCampus() {
    this.showLockOverlay = true; 
    this.mapService.removeRouting(); 

    this.alertCtrl.getTop().then(existingAlert => {
        if (existingAlert) {
            return;
        }

        this.alertCtrl.create({
            header: 'Εκτός Εμβέλειας',
            message: 'Βρίσκεστε εκτός της καθορισμένης εμβέλειας της πανεπιστημιούπολης. Η εφαρμογή θα τερματιστεί.',
            buttons: [
                {
                    text: 'Έξοδος',
                    handler: async () => {
                        const cap = (window as any).Capacitor;
                        if (cap && cap.isNative) {
                            await new Promise(resolve => setTimeout(resolve, 50)); 
                            App.exitApp(); 
                        } else {
                            console.log('Έξοδος σε Web/Browser: Η καρτέλα θα προσπαθήσει να κλείσει.');
                            window.close(); 
                        }
                        return undefined;
                    }
                }
            ]
        }).then(a => a.present());
    });
  }


  private subscribeToMapEvents() {
    // 1. Ενημέρωση Θέσης GPS (Εντός/Εκτός Campus Check)
    const locSub = this.mapService.locationFound.subscribe(pos => {
      if (this.isLocationWithinCampus(pos.lat, pos.lng)) {
          this.userLat = pos.lat;
          this.userLng = pos.lng;
          this.showLockOverlay = false; 
      } else {
          this.handleOutsideCampus();
      }
    });

    // 2. Χειρισμός Αποτυχίας GPS (ΠΡΟΣΩΡΙΝΑ ΑΝΕΝΕΡΓΟ)
    const errSub = this.mapService.locationError.subscribe(() => {
        // 🛑 ΠΡΟΣΩΡΙΝΗ ΡΥΘΜΙΣΗ: Αγνοούμε το σφάλμα GPS για να μη μπλοκάρει το testing
        // this.handleOutsideCampus(); 
    });

    // 3. Χειρισμός Κλικ Χάρτη
    const clickSub = this.mapService.mapClicked.subscribe(data => {
      if (!this.showLockOverlay) { 
        const name = data.name || 'Επιλεγμένος προορισμός';
        this.handleMapClick(data.lat, data.lng, name);
      }
    });

    this.mapSubscriptions.push(locSub, errSub, clickSub); 
  }

  // =======================================================
  // 2. ΛΟΓΙΚΗ ΕΠΙΛΟΓΗΣ ΠΡΟΟΡΙΣΜΟΥ (Pinning / Modal)
  // =======================================================

  normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ς/g, 'σ');
  }

  onDestinationSelected(destination: Destination) {
    this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    const found = this.destinationList.find(d => d.name === name);
    this.currentDestination = found ? found : { name, lat, lng };

    this.distanceInMeters = this.mapService.getDistance(
      this.userLat, 
      this.userLng, 
      lat, 
      lng
    );

    this.mapService.pinDestination(lat, lng);

    this.showModal = true;
  }

  // =======================================================
  // 3. ΛΟΓΙΚΗ ΕΥΡΕΣΗΣ ΑΦΕΤΗΡΙΑΣ & ΠΛΟΗΓΗΣΗΣ (Custom Routing)
  // =======================================================

  private async getStartPoint(): Promise<L.LatLng> {
    const from = L.latLng(this.userLat, this.userLng);

    const to = L.latLng(this.currentDestination!.lat, this.currentDestination!.lng);
    this.distanceInMeters = from.distanceTo(to); 
    
    return from;
  }

  async startNavigation() {
  if (!this.currentDestination) return;

  const startPoint = await this.getStartPoint();

  const destinationName = this.currentDestination.name
      .replace(/Τμήμα\s+/g, '')
      .replace(/Σχολή\s+/g, '')
      .toUpperCase();

  // 🔥 ΔΕΙΤΕ ΤΙ ΟΝΟΜΑ ΠΗΓΑΙΝΕΙ ΣΤΟ GRAPH
  console.warn("Destination NAME:", this.currentDestination.name);
  console.warn("Normalized:", destinationName);

  this.mapService.drawCustomRoute(startPoint, destinationName);

  this.showModal = false;

  this.userLat = this.currentDestination.lat;
  this.userLng = this.currentDestination.lng;
}

}