import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import * as L from 'leaflet';
import { IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { Destination, destinationList } from '../models/destination.model';
import { MapService } from '../services/map.service';
import { SearchBarComponent } from '../components/search-bar/search-bar.component';
import { DepartmentPopupComponent } from '../components/department-popup/department-popup.component';

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
  private mapService = inject(MapService);

  routeReady = false;
  navigationActive = false;

  simulateMovement = true;
  simulationInterval: any = null;
  simulationStepMs = 1200;

  userLat = 40.656115;
  userLng = 22.803626;

  currentDestination: Destination | null = null;
  showModal = false;
  showLockOverlay = false;

  destinationList = destinationList;

  isSearchOpen = false;
  hasArrived = false;
  selectionLocked = false;

  // TOP (instructions only)
  navEnabled = false;
  navInstruction = 'Προορισμός...';
  navTheme: 'nav-go' | 'nav-turn' | 'nav-arrive' = 'nav-go';
  navIcon: string = 'navigate-outline';

  routeTotalMeters = 0;
  routeRemainingMeters = 0;

  // κάτω popup metrics
  popupMeters: number | null = null;
  popupEtaMin: number | null = null;

  private maneuvers: { i: number; type: 'left' | 'right' }[] = [];
  private mapSubscriptions: Subscription[] = [];

  ngOnInit() {
    this.subscribeToMapEvents();
  }

  ngOnDestroy() {
    this.mapSubscriptions.forEach(s => s.unsubscribe());
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    this.mapService.stopGpsWatch();
  }

  ionViewDidEnter() {
    const st: any = history.state;
    if (st?.lat && st?.lng) {
      this.userLat = st.lat;
      this.userLng = st.lng;
    }

    this.mapService.initializeMap(this.userLat, this.userLng, 'map');
    this.mapService.startGpsWatch();
  }

  private async presentToast(message: string) {
    const toast = document.createElement('ion-toast');
    toast.message = message;
    toast.duration = 1800;
    toast.position = 'top';
    document.body.appendChild(toast);
    await toast.present();
  }

  private async presentLoading(message: string, durationMs = 700) {
    const loading = document.createElement('ion-loading');
    loading.message = message;
    loading.spinner = 'crescent';
    document.body.appendChild(loading);
    await loading.present();

    await new Promise(res => setTimeout(res, durationMs));
    await loading.dismiss();
  }

  private etaFromMeters(m: number): number {
    // ~ 78 m/min (walking)
    const metersPerMinute = 78;
    return Math.max(1, Math.ceil(m / metersPerMinute));
  }

  private bearing(a: L.LatLng, b: L.LatLng) {
    const toRad = (x: number) => x * Math.PI / 180;
    const toDeg = (x: number) => x * 180 / Math.PI;

    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // FIX: σωστό left/right
  private buildManeuvers(points: L.LatLng[]) {
    const out: { i: number; type: 'left' | 'right' }[] = [];
    if (!points || points.length < 3) return out;

    const TURN_ANGLE_DEG = 70;
    const MIN_SEGMENT_M = 8;

    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];

      const d1 = p0.distanceTo(p1);
      const d2 = p1.distanceTo(p2);
      if (d1 < MIN_SEGMENT_M || d2 < MIN_SEGMENT_M) continue;

      const v1x = p1.lng - p0.lng;
      const v1y = p1.lat - p0.lat;
      const v2x = p2.lng - p1.lng;
      const v2y = p2.lat - p1.lat;

      const cross = v1x * v2y - v1y * v2x;
      const dot = v1x * v2x + v1y * v2y;

      const angle = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
      if (angle < TURN_ANGLE_DEG) continue;

      // cross>0 => LEFT (στο lat/lng επίπεδο)
      out.push({ i, type: cross > 0 ? 'left' : 'right' });
      i += 1;
    }

    return out;
  }

  // ΠΟΤΕ "Τώρα" / "Σε λίγο" -> πάντα "Σε X μ ..."
  private updateNavInstruction(currentPoint: L.LatLng, points: L.LatLng[]) {
    if (!this.navEnabled || !points || points.length < 2) {
      this.navInstruction = 'Προορισμός...';
      this.navIcon = 'navigate-outline';
      this.navTheme = 'nav-go';
      return;
    }

    let closest = 0;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = currentPoint.distanceTo(points[i]);
      if (d < best) { best = d; closest = i; }
    }

    const lastPoint = points[points.length - 1];
    const distToEnd = currentPoint.distanceTo(lastPoint);

    const ARRIVE_DIST = 25;
    if (distToEnd <= ARRIVE_DIST) {
      this.navInstruction = 'Ο προορισμός είναι μπροστά σας';
      this.navIcon = 'flag-outline';
      this.navTheme = 'nav-arrive';
      return;
    }

    const next = this.maneuvers.find(m => m.i > closest);
    const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10);

    if (!next) {
      const d = round10(distToEnd);
      this.navInstruction = `Συνέχισε ευθεία για ${d} μ`;
      this.navIcon = 'arrow-up-outline';
      this.navTheme = 'nav-go';
      return;
    }

    const distToTurn = currentPoint.distanceTo(points[next.i]);
    const d = round10(distToTurn);

    const dirText = next.type === 'left' ? 'στρίψε αριστερά' : 'στρίψε δεξιά';
    this.navInstruction = `Σε ${d} μ ${dirText}`;
    this.navIcon = next.type === 'left' ? 'return-up-back-outline' : 'return-up-forward-outline';
    this.navTheme = 'nav-turn';
  }

  private getTestStartPoint(): L.LatLng {
    const baseLat = 40.656115;
    const baseLng = 22.803626;

    for (let k = 0; k < 15; k++) {
      const lat = baseLat + (Math.random() - 0.5) * 0.0012;
      const lng = baseLng + (Math.random() - 0.5) * 0.0012;

      if (this.mapService.isPointInsideCampus(lat, lng)) {
        return L.latLng(lat, lng);
      }
    }
    return L.latLng(baseLat, baseLng);
  }

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
        this.hasArrived = true;
        this.mapService.setFollowUser(false);

        this.navEnabled = true;
        this.navTheme = 'nav-arrive';
        this.navIcon = 'flag-outline';
        this.navInstruction = 'Ο προορισμός είναι μπροστά σας';
        return;
      }

      const point = points[index];

      if (prevPoint) {
        const heading = this.bearing(prevPoint, point);
        this.mapService.setUserHeading(heading);
      }
      prevPoint = point;

      this.userLat = point.lat;
      this.userLng = point.lng;

      this.mapService.updateUserPosition(point.lat, point.lng);

      const passed = points.slice(0, index + 1);
      const remaining = points.slice(index);
      this.mapService.updateRouteProgress(passed, remaining);

      this.updateNavInstruction(point, points);

      index++;
    }, this.simulationStepMs);
  }

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
        await this.presentToast('Πάτα Χ στο popup για ακύρωση.');
        return;
      }

      const name = data.name || 'Επιλεγμένος προορισμός';
      this.handleMapClick(data.lat, data.lng, name);
    });

    const progSub = this.mapService.routeProgress.subscribe(p => {
      this.routeTotalMeters = Math.max(0, Math.ceil(p.totalMeters));
      this.routeRemainingMeters = Math.max(0, Math.ceil(p.remainingMeters));

      // μέτρα/λεπτά ΜΟΝΟ κάτω (popup)
      if (this.navigationActive) {
        this.popupMeters = this.routeRemainingMeters;
        this.popupEtaMin = this.etaFromMeters(this.routeRemainingMeters);
      } else if (this.routeReady) {
        this.popupMeters = this.routeTotalMeters;
        this.popupEtaMin = this.etaFromMeters(this.routeTotalMeters);
      } else {
        this.popupMeters = null;
        this.popupEtaMin = null;
      }
    });

    this.mapSubscriptions.push(locSub, errSub, clickSub, progSub);
  }

  async onDestinationSelected(destination: Destination) {
    if (this.selectionLocked) {
      await this.presentToast('Πάτα Χ στο popup για ακύρωση.');
      return;
    }
    this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  onSearchOpenChange(open: boolean) {
    this.isSearchOpen = open;
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    if (this.selectionLocked) {
      await this.presentToast('Πάτα Χ στο popup για ακύρωση.');
      return;
    }

    const found = this.destinationList.find(d => d.name === name);

    this.hasArrived = false;

    // reset top instructions
    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = 'navigate-outline';
    this.navTheme = 'nav-go';

    // reset route
    this.routeReady = false;
    this.navigationActive = false;
    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    // reset popup metrics
    this.popupMeters = null;
    this.popupEtaMin = null;

    if (found) {
      this.currentDestination = found;
      const pinLat = found.entranceLat ?? found.lat;
      const pinLng = found.entranceLng ?? found.lng;
      this.mapService.pinDestination(pinLat, pinLng, found.name);
    } else {
      this.currentDestination = { name, lat, lng };
      this.mapService.pinDestination(lat, lng, this.currentDestination.name);
    }

    const start = this.simulateMovement
      ? this.getTestStartPoint()
      : L.latLng(this.userLat, this.userLng);

    await this.mapService.drawCustomRouteToDestination(this.currentDestination, start);

    const routePts = this.mapService.getCurrentRoutePoints();
    this.maneuvers = this.buildManeuvers(routePts);

    const totalMetersRaw = this.mapService.getCurrentRouteDistanceMeters();
    const totalMeters = Math.max(0, Math.ceil(totalMetersRaw));

    this.routeTotalMeters = totalMeters;
    this.routeRemainingMeters = totalMeters;

    // κάτω δείχνει μέτρα + λεπτά
    this.popupMeters = totalMeters;
    this.popupEtaMin = this.etaFromMeters(totalMeters);

    this.routeReady = true;
    this.showModal = true;

    // κλειδώνει επιλογή όσο υπάρχει route/popup
    this.selectionLocked = true;
  }

  async startNavigation() {
    if (!this.currentDestination || !this.routeReady) return;

    await this.presentLoading('Φόρτωση διαδρομής...');
    this.hasArrived = false;

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

    this.mapService.setFollowUser(true, 19);
    this.mapService.focusOn(this.userLat, this.userLng, 19);

    // πάνω: μόνο οδηγίες
    this.navEnabled = true;
    this.navigationActive = true;

    const route = this.mapService.getCurrentRoutePoints();
    this.updateNavInstruction(L.latLng(this.userLat, this.userLng), route);

    if (this.simulateMovement) {
      this.simulateUserWalk(route);
    }
  }

  cancelRouteKeepPopup() {
    this.navigationActive = false;
    this.hasArrived = false;

    if (this.simulationInterval) clearInterval(this.simulationInterval);
    this.mapService.setFollowUser(false);

    // κρατάμε pin, σβήνουμε route
    const dest = this.currentDestination;
    const pinLat = dest ? (dest.entranceLat ?? dest.lat) : null;
    const pinLng = dest ? (dest.entranceLng ?? dest.lng) : null;

    this.mapService.removeRouting(true);

    if (pinLat != null && pinLng != null && dest) {
      this.mapService.pinDestination(pinLat, pinLng, dest.name);
    }

    // reset route state (popup stays)
    this.routeReady = false;
    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    // top instructions off
    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = 'navigate-outline';
    this.navTheme = 'nav-go';

    // τώρα μπορεί να επιλέξει νέο προορισμό
    this.selectionLocked = false;
    this.showModal = true;
  }

  // Χ στο popup (όταν ΔΕΝ τρέχει navigation): κλείνει popup κανονικά
  onPopupClose() {
    this.showModal = true;

    this.navigationActive = false;
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.setFollowUser(false);
    this.mapService.removeRouting();

    this.routeReady = false;
    this.hasArrived = false;
    this.currentDestination = null;

    this.selectionLocked = false;

    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = 'navigate-outline';
    this.navTheme = 'nav-go';

    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    this.maneuvers = [];
  }

  async onAmeaClick() {
    await this.presentToast('Προσβασιμότητα: σύντομα');
  }

  async onSearchLockedAttempt() {
    await this.presentToast('Πάτα Χ στο popup για ακύρωση.');
  }
}
