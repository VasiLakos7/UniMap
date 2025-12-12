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

  hasArrived = false;

  // ✅ LOCK: όταν υπάρχει ενεργή/υπολογισμένη διαδρομή
  selectionLocked = false;

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

  private async presentToast(message: string) {
    const toast = document.createElement('ion-toast');
    toast.message = message;
    toast.duration = 1800;
    toast.position = 'top';
    document.body.appendChild(toast);
    await toast.present();
  }

  // ✅ bearing για να γυρίζει το βελάκι στο simulation
  private bearing(a: L.LatLng, b: L.LatLng) {
    const toRad = (x: number) => x * Math.PI / 180;
    const toDeg = (x: number) => x * 180 / Math.PI;

    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // -------------------------------------------------
  // SIMULATION + follow zoom σε όλη τη διαδρομή
  // -------------------------------------------------
  simulateUserWalk(points: L.LatLng[]) {
    if (!points || points.length === 0) return;

    let index = 0;
    let prevPoint: L.LatLng | null = null;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.simulationInterval = setInterval(() => {

      if (!this.navigationActive) {
        clearInterval(this.simulationInterval);
        return;
      }

      if (index >= points.length) {
        this.mapService.updateRouteProgress(points, []);
        clearInterval(this.simulationInterval);

        this.navigationActive = false;
        this.routeReady = true;
        this.hasArrived = true;

        // ✅ σταματά το follow όταν φτάσει
        this.mapService.setFollowUser(false);

        console.log('🎉 Έφτασες στον προορισμό!');
        return;
      }

      const point = points[index];

      // ✅ περιστροφή βέλους προς την κατεύθυνση κίνησης
      if (prevPoint) {
        const heading = this.bearing(prevPoint, point);
        this.mapService.setUserHeading(heading);
      }
      prevPoint = point;

      this.userLat = point.lat;
      this.userLng = point.lng;

      // ✅ αυτό τώρα θα μετακινεί και τον χάρτη (follow mode)
      this.mapService.updateUserPosition(point.lat, point.lng);

      const passed = points.slice(0, index + 1);
      const remaining = points.slice(index);
      this.mapService.updateRouteProgress(passed, remaining);

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

    const clickSub = this.mapService.mapClicked.subscribe(async data => {
      if (this.showLockOverlay) return;
      if (this.isSearchOpen) return;

      if (this.selectionLocked) {
        await this.presentToast('Πάτα Χ για να ακυρώσεις τη διαδρομή και να επιλέξεις νέο προορισμό.');
        return;
      }

      const name = data.name || 'Επιλεγμένος προορισμός';
      this.handleMapClick(data.lat, data.lng, name);
    });

    this.mapSubscriptions.push(locSub, errSub, clickSub);
  }

  // -------------------------------------------------
  // Επιλογή προορισμού από search bar
  // -------------------------------------------------
  async onDestinationSelected(destination: Destination) {
    if (this.selectionLocked) {
      await this.presentToast('Πάτα Χ για να ακυρώσεις τη διαδρομή και να επιλέξεις νέο προορισμό.');
      return;
    }
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
    if (this.selectionLocked) {
      await this.presentToast('Πάτα Χ για να ακυρώσεις τη διαδρομή και να επιλέξεις νέο προορισμό.');
      return;
    }

    const found = this.destinationList.find(d => d.name === name);
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

    this.selectionLocked = true;
  }

  // -------------------------------------------------
  // START NAVIGATION
  // -------------------------------------------------
  async startNavigation() {
    if (!this.currentDestination || !this.routeReady) return;

    this.hasArrived = false;

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

    // ✅ follow για όλη τη διάρκεια (zoom 19 για να μην γκριζάρει)
    this.mapService.setFollowUser(true, 19);
    this.mapService.focusOn(this.userLat, this.userLng, 19);

    this.navigationActive = true;

    if (this.simulateMovement) {
      const route = this.mapService.getCurrentRoutePoints();
      this.simulateUserWalk(route);
    }

    console.log('🚀 Navigation started!');
  }

  // -------------------------------------------------
  // CANCEL NAVIGATION (σταματάει κίνηση, ΔΕΝ ξεκλειδώνει)
  // -------------------------------------------------
  cancelNavigation() {
    this.navigationActive = false;
    this.hasArrived = false;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    // ✅ σταματά follow (η διαδρομή μένει, αλλά δεν σε “τραβάει”)
    this.mapService.setFollowUser(false);

    console.log('⏸ Navigation paused/canceled (route kept).');
  }

  // -------------------------------------------------
  // X CLOSE: ΠΛΗΡΗΣ ΑΚΥΡΩΣΗ + UNLOCK
  // -------------------------------------------------
  onPopupClose() {
    this.showModal = false;

    this.navigationActive = false;
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    // ✅ stop follow
    this.mapService.setFollowUser(false);

    // ✅ πλήρης ακύρωση διαδρομής + pins
    this.mapService.removeRouting();

    this.routeReady = false;
    this.hasArrived = false;
    this.currentDestination = null;

    this.selectionLocked = false;

    console.log('❌ Route cleared (X pressed).');
  }
}
