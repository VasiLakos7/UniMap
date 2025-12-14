import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
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

  // -----------------------------
  // Services
  // -----------------------------
  private router = inject(Router);
  private mapService = inject(MapService);

  // -----------------------------
  // State
  // -----------------------------
  routeReady = false;
  navigationActive = false;

  simulateMovement = true;
  simulationInterval: any = null;

  // πιο αργό simulation (άλλαζε το όσο θες)
  simulationStepMs = 1200;

  userLat = 40.656115;
  userLng = 22.803626;

  currentDestination: Destination | null = null;
  showModal = false;
  showLockOverlay = false;

  destinationList = destinationList;

  isSearchOpen = false;
  hasArrived = false;

  // ✅ κλειδώνει επιλογή νέου προορισμού όταν έχει βγει route
  selectionLocked = false;

  // -----------------------------
  // NAV BOX (οδηγίες πάνω)
  // Θέλουμε να φαίνεται ΜΟΝΟ αφού πατηθεί "ΞΕΚΙΝΑ"
  // -----------------------------
  navEnabled = false;
  navInstruction = 'Προορισμός...';
  navTheme: 'nav-green' | 'nav-orange' | 'nav-blue' = 'nav-blue';
  navIcon = '📍';
  navSub: string | null = null;

  // maneuvers (στροφές)
  private maneuvers: { i: number; type: 'left' | 'right' }[] = [];

  private mapSubscriptions: Subscription[] = [];

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

  // -------------------------------------------
  // UI helpers
  // -------------------------------------------
  private async presentToast(message: string) {
    const toast = document.createElement('ion-toast');
    toast.message = message;
    toast.duration = 1800;
    toast.position = 'top';
    document.body.appendChild(toast);
    await toast.present();
  }

  private async presentLoading(message: string, durationMs = 900) {
    const loading = document.createElement('ion-loading');
    loading.message = message;
    loading.spinner = 'crescent';
    document.body.appendChild(loading);
    await loading.present();

    await new Promise(res => setTimeout(res, durationMs));
    await loading.dismiss();
  }

  // -------------------------------------------
  // Bearing (για περιστροφή βέλους στο simulation)
  // -------------------------------------------
  private bearing(a: L.LatLng, b: L.LatLng) {
    const toRad = (x: number) => x * Math.PI / 180;
    const toDeg = (x: number) => x * 180 / Math.PI;

    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // -------------------------------------------
  // Maneuvers: σωστό left/right με cross product
  // (στο δικό σου dataset χρειάζεται FLIP)
  // -------------------------------------------
  private buildManeuvers(points: L.LatLng[]) {
    const out: { i: number; type: 'left' | 'right' }[] = [];
    if (!points || points.length < 3) return out;

    const TURN_ANGLE_DEG = 70; // ✅ μόνο “κανονικές” στροφές 70°+
    const MIN_SEGMENT_M = 8;   // ✅ κόβει μικρά ζιγκ-ζαγκ

    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];

      // αν τα segments είναι πολύ μικρά → θόρυβος
      const d1 = p0.distanceTo(p1);
      const d2 = p1.distanceTo(p2);
      if (d1 < MIN_SEGMENT_M || d2 < MIN_SEGMENT_M) continue;

      // vectors (x=lng, y=lat)
      const v1x = p1.lng - p0.lng;
      const v1y = p1.lat - p0.lat;
      const v2x = p2.lng - p1.lng;
      const v2y = p2.lat - p1.lat;

      const cross = v1x * v2y - v1y * v2x;
      const dot = v1x * v2x + v1y * v2y;

      // angle 0..180
      const angle = (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;

      // ✅ κρατάμε μόνο μεγάλες στροφές
      if (angle < TURN_ANGLE_DEG) continue;

      // ✅ FLIP (όπως είχαμε για να ταιριάξει με το δικό σου route)
      out.push({ i, type: cross > 0 ? 'right' : 'left' });
      i += 1;
    }

    return out;
  }


  // -------------------------------------------
  // Update οδηγίας με βάση θέση + route
  // - "Σε λίγο στρίψε ..." πριν τη στροφή
  // - "Συνέχισε ευθεία" σε μεγάλες ευθείες
  // - "Ο προορισμός..." μόνο κοντά στο τέλος
  // -------------------------------------------
  private updateNavInstruction(currentPoint: L.LatLng, points: L.LatLng[]) {
    if (!this.navEnabled) {
      this.navInstruction = 'Προορισμός...';
      this.navIcon = '📍';
      this.navTheme = 'nav-blue';
      this.navSub = null;
      return;
    }

    if (!points || points.length < 2) {
      this.navInstruction = 'Προορισμός...';
      this.navIcon = '📍';
      this.navTheme = 'nav-blue';
      this.navSub = null;
      return;
    }

    // closest index
    let closest = 0;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = currentPoint.distanceTo(points[i]);
      if (d < best) { best = d; closest = i; }
      
    }

    const lastPoint = points[points.length - 1];
    const distToEnd = currentPoint.distanceTo(lastPoint);

    // ✅ άφιξη ΜΟΝΟ όταν είμαστε κοντά στο τέλος
    const ARRIVE_DIST = 25; // meters
    if (distToEnd <= ARRIVE_DIST) {
      this.navInstruction = 'Ο προορισμός βρίσκεται μπροστά σας';
      this.navIcon = '📍';
      this.navTheme = 'nav-green';
      this.navSub = null;
      return;
    }

    const next = this.maneuvers.find(m => m.i > closest);

    // thresholds (προς το παρόν χωρίς “μέτρα” στο UI)
    const TURN_NOW = 18;        // “τώρα στρίψε”
    const PRE_TURN = 80;        // “σε λίγο στρίψε”
    const LONG_STRAIGHT = 140;  // μεγάλη ευθεία => “Συνέχισε ευθεία”

    if (!next) {
      // δεν υπάρχει άλλη στροφή, αλλά δεν είμαστε στο τέλος -> συνεχίζουμε ευθεία
      this.navInstruction = 'Συνέχισε ευθεία';
      this.navIcon = '⬆️';
      this.navTheme = 'nav-blue';
      this.navSub = null;
      return;
    }

    const distToTurn = currentPoint.distanceTo(points[next.i]);

    // (αργότερα εδώ κουμπώνεις μέτρα εύκολα)
    // this.navSub = `${Math.round(distToTurn)} μ μέχρι τη στροφή`;
    this.navSub = null;

    // 1) ΤΩΡΑ στρίψε
    if (distToTurn <= TURN_NOW) {
      if (next.type === 'left') {
        this.navInstruction = 'Στρίψε αριστερά';
        this.navIcon = '⬅️';
      } else {
        this.navInstruction = 'Στρίψε δεξιά';
        this.navIcon = '➡️';
      }
      this.navTheme = 'nav-orange';
      return;
    }

    // 2) ΠΡΙΝ φτάσει: “σε λίγο”
    if (distToTurn <= PRE_TURN) {
      if (next.type === 'left') {
        this.navInstruction = 'Σε λίγο στρίψε αριστερά';
        this.navIcon = '⬅️';
      } else {
        this.navInstruction = 'Σε λίγο στρίψε δεξιά';
        this.navIcon = '➡️';
      }
      this.navTheme = 'nav-orange';
      return;
    }

    // 3) Μεγάλη ευθεία
    if (distToTurn >= LONG_STRAIGHT) {
      this.navInstruction = 'Συνέχισε ευθεία';
      this.navIcon = '⬆️';
      this.navTheme = 'nav-blue';
      return;
    }

    // 4) Default: πήγαινε ευθεία
    this.navInstruction = 'Πήγαινε ευθεία';
    this.navIcon = '⬆️';
    this.navTheme = 'nav-blue';
  }

  // -------------------------------------------------
  // SIMULATION (πιο αργό + follow + σωστές οδηγίες)
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
        // τέλος simulation
        this.mapService.updateRouteProgress(points, []);
        clearInterval(this.simulationInterval);

        this.navigationActive = false;
        this.hasArrived = true;
        this.mapService.setFollowUser(false);
        return;
      }

      const point = points[index];

      // περιστροφή βέλους
      if (prevPoint) {
        const heading = this.bearing(prevPoint, point);
        this.mapService.setUserHeading(heading);
      }
      prevPoint = point;

      this.userLat = point.lat;
      this.userLng = point.lng;

      // follow + marker update
      this.mapService.updateUserPosition(point.lat, point.lng);

      // progress line (passed/remaining)
      const passed = points.slice(0, index + 1);
      const remaining = points.slice(index);
      this.mapService.updateRouteProgress(passed, remaining);

      // ✅ οδηγίες (μόνο αφού πατήσει ΞΕΚΙΝΑ)
      this.updateNavInstruction(point, points);

      index++;
    }, this.simulationStepMs);
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

    const errSub = this.mapService.locationError.subscribe(() => { });

    const clickSub = this.mapService.mapClicked.subscribe(async data => {
      if (this.showLockOverlay) return;
      if (this.isSearchOpen) return;

      // ✅ lock: δεν επιτρέπουμε νέο προορισμό μέχρι Χ
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
  // Search events
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
  // Επιλογή προορισμού (click/search)
  // -------------------------------------------------
  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    if (this.selectionLocked) {
      await this.presentToast('Πάτα Χ για να ακυρώσεις τη διαδρομή και να επιλέξεις νέο προορισμό.');
      return;
    }

    const found = this.destinationList.find(d => d.name === name);
    this.hasArrived = false;

    // πριν πατηθεί ΞΕΚΙΝΑ, δεν θέλουμε οδηγίες
    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = '📍';
    this.navTheme = 'nav-blue';
    this.navSub = null;

    if (found) {
      this.currentDestination = found;
      const pinLat = found.entranceLat ?? found.lat;
      const pinLng = found.entranceLng ?? found.lng;
      this.mapService.pinDestination(pinLat, pinLng, found.name);
    } else {
      this.currentDestination = { name, lat, lng };
      this.mapService.pinDestination(lat, lng, this.currentDestination.name);
    }

    // υπολογισμός/σχεδίαση διαδρομής
    await this.mapService.drawCustomRouteToDestination(this.currentDestination!);

    // build maneuvers
    const routePts = this.mapService.getCurrentRoutePoints();
    this.maneuvers = this.buildManeuvers(routePts);

    this.routeReady = true;
    this.navigationActive = false;
    this.showModal = true;

    // ✅ lock μέχρι να πατηθεί Χ
    this.selectionLocked = true;
  }

  // -------------------------------------------------
  // START NAVIGATION
  // -------------------------------------------------
  async startNavigation() {
    if (!this.currentDestination || !this.routeReady) return;

    // short loading (σαν “φορτώνει”)
    await this.presentLoading('Φόρτωση διαδρομής...');

    this.hasArrived = false;

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

    // ✅ follow σε όλη τη διάρκεια
    this.mapService.setFollowUser(true, 19);
    this.mapService.focusOn(this.userLat, this.userLng, 19);

    // ✅ δείξε οδηγίες μόνο μετά το ΞΕΚΙΝΑ
    this.navEnabled = true;

    this.navigationActive = true;

    // αρχική οδηγία
    const route = this.mapService.getCurrentRoutePoints();
    this.updateNavInstruction(L.latLng(this.userLat, this.userLng), route);

    if (this.simulateMovement) {
      this.simulateUserWalk(route);
    }
  }

  // -------------------------------------------------
  // CANCEL NAVIGATION (σταματάει κίνηση, route μένει, lock μένει)
  // -------------------------------------------------
  cancelNavigation() {
    this.navigationActive = false;
    this.hasArrived = false;

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.setFollowUser(false);

    // κρύψε οδηγίες (μέχρι να ξαναπατήσει ΞΕΚΙΝΑ)
    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = '📍';
    this.navTheme = 'nav-blue';
    this.navSub = null;
  }

  // -------------------------------------------------
  // X CLOSE: ΠΛΗΡΗΣ ΑΚΥΡΩΣΗ + UNLOCK
  // -------------------------------------------------
  onPopupClose() {
    this.showModal = false;

    this.navigationActive = false;
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.setFollowUser(false);

    // πλήρης ακύρωση route + pins
    this.mapService.removeRouting();

    this.routeReady = false;
    this.hasArrived = false;
    this.currentDestination = null;

    // ✅ unlock μόνο εδώ
    this.selectionLocked = false;

    // reset nav
    this.navEnabled = false;
    this.navInstruction = 'Προορισμός...';
    this.navIcon = '📍';
    this.navTheme = 'nav-blue';
    this.navSub = null;

    this.maneuvers = [];
  }
}
