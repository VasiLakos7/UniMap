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

  // STATE
  routeReady = false;
  navigationActive = false;
  simulateMovement = true;
  simulationInterval: any = null;

  userLat = 40.656115;
  userLng = 22.803626;

  distanceInMeters = 0;
  currentDestination: Destination | null = null;
  showModal: boolean = false;
  showLockOverlay: boolean = false;
  destinationList = destinationList;

  private mapSubscriptions: Subscription[] = [];

  private defaultStartPoint = L.latLng(this.userLat, this.userLng);

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
    if (this.simulationInterval) clearInterval(this.simulationInterval);
  }

  ionViewDidEnter() {
    this.mapService.initializeMap(this.userLat, this.userLng, 'map');
  }

  // -------------------------------------------------
  // SIMULATION
  // -------------------------------------------------
  simulateUserWalk(points: L.LatLng[]) {
    if (!points || points.length === 0) return;

    let index = 0;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.simulationInterval = setInterval(() => {

      if (!this.navigationActive) {
        clearInterval(this.simulationInterval);
        return;
      }

      if (index >= points.length) {
        clearInterval(this.simulationInterval);

        this.navigationActive = false;
        this.routeReady = true;

        setTimeout(() => {
          this.showModal = false;
          setTimeout(() => {
            this.showModal = true;
          }, 30);
        }, 30);

        console.log('🎉 Έφτασες στον προορισμό!');
        return;
      }

      const point = points[index];
      this.userLat = point.lat;
      this.userLng = point.lng;

      this.mapService.updateUserPosition(point.lat, point.lng);

      (this.mapService as any).map?.setView([point.lat, point.lng], 18, {
        animate: true
      });

      index++;
    }, 600);
  }

  // -------------------------------------------------
  // MAP EVENTS
  // -------------------------------------------------
  private subscribeToMapEvents() {
    const locSub = this.mapService.locationFound.subscribe(pos => {
      // σε κανονική χρήση θα έκανες update εδώ.
      this.showLockOverlay = false;
    });

    const errSub = this.mapService.locationError.subscribe(() => {});

    const clickSub = this.mapService.mapClicked.subscribe(data => {
      if (!this.showLockOverlay) {
        const name = data.name || 'Επιλεγμένος προορισμός';
        this.handleMapClick(data.lat, data.lng, name);
      }
    });

    this.mapSubscriptions.push(locSub, errSub, clickSub);
  }

  // -------------------------------------------------
  // Επιλογή προορισμού
  // -------------------------------------------------
  onDestinationSelected(destination: Destination) {
    this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    const found = this.destinationList.find(d => d.name === name);
    this.currentDestination = found ? found : { name, lat, lng };

    // Pin στην είσοδο/κέντρο
    const pinLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const pinLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(pinLat, pinLng);

    // σταθερό σημείο εκκίνησης για testing
    const start = L.latLng(40.656115, 22.803626);
    this.userLat = start.lat;
    this.userLng = start.lng;

    // 👉 Καλούμε τη νέα μέθοδο με όλο το Destination
    await this.mapService.drawCustomRouteToDestination(start, this.currentDestination);

    this.routeReady = true;
    this.navigationActive = false;
    this.showModal = true;
  }

  // -------------------------------------------------
  // START NAVIGATION
  // -------------------------------------------------
  async startNavigation() {
    if (!this.currentDestination) return;

    this.navigationActive = true;

    if (this.simulateMovement) {
      const route = this.mapService.getCurrentRoutePoints();
      this.simulateUserWalk(route);
    }

    console.log('🚀 Navigation started!');
  }

  // -------------------------------------------------
  // CANCEL NAVIGATION
  // -------------------------------------------------
  cancelNavigation() {
    this.navigationActive = false;
    this.routeReady = false;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.removeRouting();
    console.log('❌ Navigation canceled.');
  }
}
