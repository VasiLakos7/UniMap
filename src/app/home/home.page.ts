import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Destination, destinationList } from '../models/destination.model';
import { MapService } from '../services/map.service';
import { SearchBarComponent } from '../components/search-bar/search-bar.component';
import { DepartmentPopupComponent } from '../components/department-popup/department-popup.component';
import { Subscription } from 'rxjs';

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

  isSearchOpen = false;

  // 🔹 ΝΕΟ: είμαστε ήδη στον προορισμό;
  hasArrived = false;

  private mapSubscriptions: Subscription[] = [];

  constructor(
    private router: Router,
    private mapService: MapService
  ) {}

  ngOnInit() {
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
  // SIMULATION + γραμμή μπροστά / πίσω
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
        // Τελικό καρέ: όλη η διαδρομή έγινε “πίσω”
        this.mapService.updateRouteProgress(points, []);
        clearInterval(this.simulationInterval);

        this.navigationActive = false;
        this.routeReady = true;
        this.hasArrived = true; // ✅ φτάσαμε

        console.log('🎉 Έφτασες στον προορισμό!');
        return;
      }

      const point = points[index];
      this.userLat = point.lat;
      this.userLng = point.lng;

      this.mapService.updateUserPosition(point.lat, point.lng);

      const passed = points.slice(0, index + 1);
      const remaining = points.slice(index);
      this.mapService.updateRouteProgress(passed, remaining);

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
      this.userLat = pos.lat;
      this.userLng = pos.lng;
      this.showLockOverlay = false;
    });

    const errSub = this.mapService.locationError.subscribe(() => {});

    const clickSub = this.mapService.mapClicked.subscribe(data => {
      if (this.showLockOverlay) return;
      if (this.isSearchOpen) return;

      const name = data.name || 'Επιλεγμένος προορισμός';
      this.handleMapClick(data.lat, data.lng, name);
    });

    this.mapSubscriptions.push(locSub, errSub, clickSub);
  }

  // -------------------------------------------------
  // Επιλογή προορισμού από search bar
  // -------------------------------------------------
  onDestinationSelected(destination: Destination) {
    this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  onSearchOpenChange(open: boolean) {
    this.isSearchOpen = open;
  }

  // -------------------------------------------------
  // Επιλογή προορισμού / click στον χάρτη
  // -------------------------------------------------
  async handleMapClick(
    lat: number,
    lng: number,
    name: string = 'Επιλεγμένος προορισμός'
  ) {
    const found = this.destinationList.find(d => d.name === name);

    // κάθε φορά που διαλέγουμε νέο προορισμό, ΔΕΝ έχουμε φτάσει ακόμα
    this.hasArrived = false;

    if (found) {
      this.currentDestination = found;
      const pinLat = found.entranceLat ?? found.lat;
      const pinLng = found.entranceLng ?? found.lng;
      this.mapService.pinDestination(pinLat, pinLng, found.name);
    } else {
      this.currentDestination = { name, lat, lng };
      this.mapService.pinDestination(lat, lng, this.currentDestination.name);
    }

    await this.mapService.drawCustomRouteToDestination(this.currentDestination!);

    this.routeReady = true;
    this.navigationActive = false;
    this.showModal = true;
  }

  // -------------------------------------------------
  // START NAVIGATION
  // -------------------------------------------------
  async startNavigation() {
    if (!this.currentDestination || !this.routeReady) return;

    this.hasArrived = false; // ξεκινάμε ξανά

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

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
    this.hasArrived = false;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.removeRouting();
    console.log('❌ Navigation canceled.');
  }
  onPopupClose() {
  // 1. Κλείσε το popup
  this.showModal = false;

  // 2. Αν είχαμε φτάσει, καθάρισε και τη διαδρομή
  if (this.hasArrived) {
    this.mapService.removeRouting();
    this.routeReady = false;
    this.navigationActive = false;
    this.hasArrived = false;
  }
}


}
