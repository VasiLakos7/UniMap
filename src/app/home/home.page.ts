import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  AfterViewChecked,
  ElementRef,
  ViewChild,
  NgZone,
  inject,
} from '@angular/core';

import * as L from 'leaflet';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, firstValueFrom } from 'rxjs';

import { Destination, destinationList } from '../models/destination.model';
import { MapService } from '../services/map.service';
import { SearchBarComponent } from '../components/search-bar/search-bar.component';
import { DepartmentPopupComponent } from '../components/department-popup/department-popup.component';

import { SettingsService, AppSettings } from '../services/settings.service';
import { SettingsModalComponent } from '../components/settings-modal/settings-modal.component';

import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { UiDialogService } from '../services/ui-dialog.service';


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
    DepartmentPopupComponent,
    TranslateModule,
  ],
})
export class HomePage implements OnInit, OnDestroy, AfterViewInit, AfterViewChecked {
  private mapService = inject(MapService);
  private modalCtrl = inject(ModalController);
  private settingsSvc = inject(SettingsService);
  private translate = inject(TranslateService);
  private uiDialog = inject(UiDialogService);
  private zone = inject(NgZone);

  private popupRO?: ResizeObserver;
  private popupObservedEl: HTMLElement | null = null;
  @ViewChild('popupCard', { read: ElementRef }) popupCard?: ElementRef<HTMLElement>;

  popupHeightPx = 0;

  // Settings
  settings: AppSettings = this.settingsSvc.defaults();

  // AMEA state
  ameaEnabled = false;

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

  // ✅ for recenter button
  hasUserFix = false;

  navEnabled = false;
  navInstructionKey = 'NAV.PLACEHOLDER';
  navInstructionParams: any = {};
  navTheme: 'nav-go' | 'nav-turn' | 'nav-arrive' = 'nav-go';
  navIcon: string = 'navigate-outline';

  routeTotalMeters = 0;
  routeRemainingMeters = 0;

  popupMeters: number | null = null;
  popupEtaMin: number | null = null;

  private maneuvers: { i: number; type: 'left' | 'right' }[] = [];
  private mapSubscriptions: Subscription[] = [];

  get recenterBottom(): number {
    const base = 14;

    const popupOpen = this.showModal && !!this.currentDestination;
    if (!popupOpen) return base;

    const h = this.popupHeightPx || 120;

    return base + h + 44; //
  }



  ngAfterViewInit() {
  
  }

  ngAfterViewChecked() {
    
    const el = this.popupCard?.nativeElement ?? null;

    // popup κλειστό
    if (!el) {
      if (this.popupRO) this.popupRO.disconnect();
      this.popupRO = undefined;
      this.popupObservedEl = null;
      this.popupHeightPx = 0;
      return;
    }

    if (this.popupObservedEl === el) return;

    this.popupRO?.disconnect();
    this.popupObservedEl = el;

    this.popupHeightPx = Math.ceil(el.getBoundingClientRect().height || 0);

    this.popupRO = new ResizeObserver((entries) => {
      const h = Math.ceil(entries[0]?.contentRect?.height ?? 0);
      this.zone.run(() => (this.popupHeightPx = h));
    });

    this.popupRO.observe(el);
  }

  async ngOnInit() {
    this.translate.addLangs(['el', 'en']);
    this.translate.setDefaultLang('el');

    this.subscribeToMapEvents();

    await this.initSettings();
    await this.applyLanguageFromSettings();
  }

  ngOnDestroy() {
    this.popupRO?.disconnect();

    this.mapSubscriptions.forEach(s => s.unsubscribe());
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    this.mapService.stopGpsWatch();
  }

  async ionViewDidEnter() {
    const st: any = history.state;
    if (st?.lat && st?.lng) {
      this.userLat = st.lat;
      this.userLng = st.lng;
    }

    this.mapService.initializeMap(this.userLat, this.userLng, 'map');
    this.applyMapSettings();

    this.hasUserFix = false;
    await this.mapService.startGpsWatch(true, 18);
  }

  // ✅ locate me
  onRecenter() {
    if (!this.hasUserFix) return;

    const ok = this.mapService.recenterToUser({ zoom: 19, follow: true, animate: true });
    if (!ok) {
      this.mapService.focusOn(this.userLat, this.userLng, 19);
      this.mapService.setFollowUser(true, 19);
    }
  }

  private async initSettings() {
    this.settings = await this.settingsSvc.load();
  }

  private normalizeLang(raw: any): 'el' | 'en' {
    const l = String(raw || '').toLowerCase();
    if (l === 'en') return 'en';
    return 'el';
  }

  private async applyLanguageFromSettings() {
    const lang = this.normalizeLang(this.settings?.language);
    try {
      await firstValueFrom(this.translate.use(lang));
    } catch {
      await firstValueFrom(this.translate.use('el'));
    }
  }

  private applyMapSettings() {
    const anyMap: any = this.mapService as any;

    if (typeof anyMap.setBaseLayerFromSettings === 'function') {
      anyMap.setBaseLayerFromSettings(this.settings.baseLayer);
    }

    if (typeof anyMap.setNorthLock === 'function') {
      anyMap.setNorthLock(this.settings.northLock);
    }
  }

  private async presentLoadingKey(key: string, params?: any, durationMs = 700) {
    const loading = document.createElement('ion-loading');
    loading.message = this.translate.instant(key, params);
    loading.spinner = 'crescent';
    document.body.appendChild(loading);
    await loading.present();

    await new Promise(res => setTimeout(res, durationMs));
    await loading.dismiss();
  }

  private async ensureUnlockedOrCancel(): Promise<boolean> {
    if (!this.selectionLocked) return true;

    const cancelRoute = await this.uiDialog.confirmKeys({
      titleKey: 'DIALOG.ROUTE_ACTIVE_TITLE',
      messageKey: 'DIALOG.ROUTE_ACTIVE_MSG',
      icon: 'warning',
      cancelKey: 'DIALOG.KEEP_ROUTE',
      confirmKey: 'DIALOG.CANCEL_ROUTE',
    });

    if (!cancelRoute) return false;

    this.onPopupClose();
    return true;
  }

  async toggleAmea() {
    this.ameaEnabled = !this.ameaEnabled;

    await this.uiDialog.info(
      'DIALOG.AMEA_TITLE',
      this.ameaEnabled ? 'DIALOG.AMEA_ON_MSG' : 'DIALOG.AMEA_OFF_MSG'
    );
  }

  async openSettings() {
    const value = await this.settingsSvc.load();

    const modal = await this.modalCtrl.create({
      component: SettingsModalComponent,
      componentProps: { value: { ...value } },
      backdropDismiss: true,
      showBackdrop: true,
      cssClass: 'settings-modal',
    });

    await modal.present();
    const res = await modal.onDidDismiss();

    if (res.role === 'save' && res.data) {
      this.settings = res.data as AppSettings;
      await this.applyLanguageFromSettings();
      this.applyMapSettings();
      return;
    }

    if (res.role === 'reset' && res.data) {
      this.settings = res.data as AppSettings;
      await this.applyLanguageFromSettings();
      this.applyMapSettings();
      return;
    }

    if (res.role === 'refreshMap') {
      await this.refreshMapWithPercent();
      await this.uiDialog.info('DIALOG.MAP_REFRESHED_TITLE', 'DIALOG.MAP_REFRESHED_MSG');
    }
  }

  private etaFromMeters(m: number): number {
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

      out.push({ i, type: cross > 0 ? 'left' : 'right' });
      i += 1;
    }

    return out;
  }

  private resetTopNav() {
    this.navEnabled = false;
    this.navInstructionKey = 'NAV.PLACEHOLDER';
    this.navInstructionParams = {};
    this.navIcon = 'navigate-outline';
    this.navTheme = 'nav-go';
  }

  private updateNavInstruction(currentPoint: L.LatLng, points: L.LatLng[]) {
    if (!this.navEnabled || !points || points.length < 2) {
      this.navInstructionKey = 'NAV.PLACEHOLDER';
      this.navInstructionParams = {};
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
      this.navInstructionKey = 'NAV.ARRIVE_AHEAD';
      this.navInstructionParams = {};
      this.navIcon = 'flag-outline';
      this.navTheme = 'nav-arrive';
      return;
    }

    const next = this.maneuvers.find(m => m.i > closest);
    const round10 = (m: number) => Math.max(10, Math.round(m / 10) * 10);

    if (!next) {
      const d = round10(distToEnd);
      this.navInstructionKey = 'NAV.GO_STRAIGHT_FOR';
      this.navInstructionParams = { meters: d };
      this.navIcon = 'arrow-up-outline';
      this.navTheme = 'nav-go';
      return;
    }

    const distToTurn = currentPoint.distanceTo(points[next.i]);
    const d = round10(distToTurn);

    this.navInstructionKey = next.type === 'left' ? 'NAV.TURN_LEFT_IN' : 'NAV.TURN_RIGHT_IN';
    this.navInstructionParams = { meters: d };
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
        this.navInstructionKey = 'NAV.ARRIVE_AHEAD';
        this.navInstructionParams = {};
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
      this.hasUserFix = true;
    });

    const errSub = this.mapService.locationError.subscribe(() => {});

    const outSub = this.mapService.outsideCampusClick.subscribe(async () => {
      await this.uiDialog.info('DIALOG.OUTSIDE_CAMPUS_TITLE', 'DIALOG.OUTSIDE_CAMPUS_MSG');
    });

    const clickSub = this.mapService.mapClicked.subscribe(async data => {
      if (this.showLockOverlay) return;
      if (this.isSearchOpen) return;

      const ok = await this.ensureUnlockedOrCancel();
      if (!ok) return;

      const fallbackName = this.translate.instant('DEST.CUSTOM.NAME') || 'Επιλεγμένος προορισμός';
      const name = data.name || fallbackName;
      void this.handleMapClick(data.lat, data.lng, name);
    });

    const progSub = this.mapService.routeProgress.subscribe(p => {
      this.routeTotalMeters = Math.max(0, Math.ceil(p.totalMeters));
      this.routeRemainingMeters = Math.max(0, Math.ceil(p.remainingMeters));

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

    this.mapSubscriptions.push(locSub, errSub, outSub, clickSub, progSub);
  }

  async onDestinationSelected(destination: Destination) {
    const ok = await this.ensureUnlockedOrCancel();
    if (!ok) return;

    void this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  onSearchOpenChange(open: boolean) {
    this.isSearchOpen = open;
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    const ok = await this.ensureUnlockedOrCancel();
    if (!ok) return;

    const found = this.destinationList.find(d => d.name === name);

    this.hasArrived = false;
    this.resetTopNav();

    this.routeReady = false;
    this.navigationActive = false;
    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    const dest: Destination = found ? found : { id: 'CUSTOM', name, lat, lng };
    this.currentDestination = dest;

    const pinLat = dest.entranceLat ?? dest.lat;
    const pinLng = dest.entranceLng ?? dest.lng;
    this.mapService.pinDestination(pinLat, pinLng, dest.name);

    const start = this.simulateMovement
      ? this.getTestStartPoint()
      : L.latLng(this.userLat, this.userLng);

    await this.mapService.drawCustomRouteToDestination(dest, start);

    const routePts = this.mapService.getCurrentRoutePoints();
    this.maneuvers = this.buildManeuvers(routePts);

    const totalMetersRaw = this.mapService.getCurrentRouteDistanceMeters();
    const totalMeters = Math.max(0, Math.ceil(totalMetersRaw));

    this.routeTotalMeters = totalMeters;
    this.routeRemainingMeters = totalMeters;

    this.popupMeters = totalMeters;
    this.popupEtaMin = this.etaFromMeters(totalMeters);

    this.routeReady = true;
    this.showModal = true;
    this.selectionLocked = true;
  }

  async startNavigation() {
    if (!this.currentDestination || !this.routeReady) return;

    await this.presentLoadingKey('LOADING.ROUTE_LOADING');
    this.hasArrived = false;

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

    this.mapService.setFollowUser(true, 19);
    this.mapService.focusOn(this.userLat, this.userLng, 19);

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

    const dest = this.currentDestination;
    const pinLat = dest ? (dest.entranceLat ?? dest.lat) : null;
    const pinLng = dest ? (dest.entranceLng ?? dest.lng) : null;

    this.mapService.removeRouting(true);

    if (pinLat != null && pinLng != null && dest) {
      this.mapService.pinDestination(pinLat, pinLng, dest.name);
    }

    this.routeReady = false;
    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    this.resetTopNav();

    this.selectionLocked = false;
    this.showModal = true;
  }

  onPopupClose() {
    this.showModal = false;

    this.popupHeightPx = 0;
    this.popupRO?.disconnect();
    this.popupRO = undefined;
    this.popupObservedEl = null;

    this.navigationActive = false;
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.setFollowUser(false);
    this.mapService.removeRouting();

    this.routeReady = false;
    this.hasArrived = false;
    this.currentDestination = null;

    this.selectionLocked = false;

    this.resetTopNav();

    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    this.maneuvers = [];
  }

  async onSearchLockedAttempt() {
    await this.ensureUnlockedOrCancel();
  }

  private async refreshMapWithPercent() {
    const loading = document.createElement('ion-loading');
    loading.message = this.translate.instant('LOADING.MAP_REFRESHING', { pct: 0 });
    loading.spinner = 'crescent';
    document.body.appendChild(loading);
    await loading.present();

    let pct = 0;
    const tick = setInterval(() => {
      pct = Math.min(90, pct + 6);
      loading.message = this.translate.instant('LOADING.MAP_REFRESHING', { pct });
    }, 120);

    const anyMap: any = this.mapService as any;
    if (typeof anyMap.refreshMap === 'function') {
      try { anyMap.refreshMap(); } catch {}
    } else {
      try { (anyMap.map ?? null)?.invalidateSize?.(true); } catch {}
    }

    await new Promise(res => setTimeout(res, 900));
    clearInterval(tick);
    loading.message = this.translate.instant('LOADING.MAP_REFRESHING', { pct: 100 });
    await new Promise(res => setTimeout(res, 250));
    await loading.dismiss();
  }
}
