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

  settings: AppSettings = this.settingsSvc.defaults();
  ameaEnabled = false;

  // route states
  routeReady = false;
  navigationActive = false;
  hasRoutePreview = false;
  outsideCampus = false;

  simulateMovement = false;
  simulationInterval: any = null;
  simulationStepMs = 1200;

  userLat = 40.656115;
  userLng = 22.803626;

  currentDestination: Destination | null = null;
  showModal = false;

  //  MAP LOADING (overlay)
  mapLoading = false;
  mapLoadingPct = 0;
  mapLoadingVisible = false; 
  mapLoadingLeaving = false; 

  private mapLoadingOffTimer: any = null;
  private mapLoadingMinTimer: any = null;

  private mapLoadingShownAt = 0;
  private mapLoadingMinUntil = 0;

  private readonly OVERLAY_FADE_MS = 240;
  private readonly OVERLAY_MIN_SHOW_MS = 5500;

  outsideCampusKnown = false;
  outsideCampusOverlay = false;

  private startOutsideDialogShown = false;
  private bootCheckRunning = false;

  destinationList = destinationList;

  isSearchOpen = false;
  hasArrived = false;
  hasUserFix = false;

  // nav-box
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

  private prevFix: L.LatLng | null = null;
  private lastRouteIndex = 0;

  private readonly BUS_STOP = L.latLng(40.657688, 22.801665);

  private lastProgressAt = 0;
  private lastNavAt = 0;
  private lastHereForProgress: L.LatLng | null = null;

  private readonly PROGRESS_MIN_INTERVAL_MS = 220;
  private readonly NAV_MIN_INTERVAL_MS = 260;
  private readonly HERE_MIN_MOVE_M = 0.9;

  private readonly WINDOW_BACK = 25;
  private readonly WINDOW_FWD = 90;
  private readonly FULLSCAN_TRIGGER_M = 35;

  selectionLocked = false;
  private lockIfHasDirections() {
    this.selectionLocked = !!(
      this.mapLoadingVisible ||
      this.showModal ||
      this.routeReady ||
      this.navigationActive ||
      this.hasRoutePreview
    );
  }
  private async ensureUnlockedOrCancel(): Promise<boolean> {
    return !this.selectionLocked;
  }
  async onSearchLockedAttempt() {}

  get recenterBottom(): number {
    const base = 14;
    const popupOpen = this.showModal && !!this.currentDestination;
    if (!popupOpen) return base;
    const h = this.popupHeightPx || 120;
    return base + h + 44;
  }

  ngAfterViewInit() {}

  ngAfterViewChecked() {
    const el = this.popupCard?.nativeElement ?? null;

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

    this.mapSubscriptions.forEach((s) => s.unsubscribe());
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    if (this.mapLoadingOffTimer) clearTimeout(this.mapLoadingOffTimer);
    if (this.mapLoadingMinTimer) clearTimeout(this.mapLoadingMinTimer);

    this.mapService.stopGpsWatch();
  }

  private async checkOutsideAfterTiles(tilesTimeoutMs = 9000) {
    if (this.bootCheckRunning) return;
    if (this.startOutsideDialogShown) return;

    this.bootCheckRunning = true;

    const tilesOk = (this.mapService as any).whenFirstTilesLoaded
      ? await (this.mapService as any).whenFirstTilesLoaded(tilesTimeoutMs)
      : true;

    if (!tilesOk) {
      this.bootCheckRunning = false;
      return;
    }

    if (!this.hasUserFix) {
      const sub = this.mapService.locationFound.subscribe(async (pos) => {
        sub.unsubscribe();
        this.userLat = pos.lat;
        this.userLng = pos.lng;
        this.hasUserFix = true;

        await this.runOutsideCheckOnce();
        this.bootCheckRunning = false;
      });
      return;
    }

    await this.runOutsideCheckOnce();
    this.bootCheckRunning = false;
  }

  private async runOutsideCheckOnce() {
    if (this.startOutsideDialogShown) return;

    const lat = this.userLat;
    const lng = this.userLng;

    const inside = (this.mapService as any).isPointInsideCampusLoose
      ? (this.mapService as any).isPointInsideCampusLoose(lat, lng, 45)
      : this.mapService.isPointInsideCampus(lat, lng);

    this.outsideCampusKnown = true;
    this.outsideCampusOverlay = !inside;

    if (!inside) {
      this.startOutsideDialogShown = true;
      //akuro dialog isws balw kati allo
      //await this.uiDialog.info('DIALOG.OUTSIDE_CAMPUS_TITLE', 'DIALOG.OUTSIDE_CAMPUS_ON_START_MSG');
    }
  }

  async ionViewDidEnter() {
    //  reset “εκκίνησης”
    this.startOutsideDialogShown = false;
    this.bootCheckRunning = false;

    this.outsideCampusKnown = false;
    this.outsideCampusOverlay = false;

    this.mapLoading = true;
    this.mapLoadingPct = 0;
    this.mapLoadingVisible = true;
    this.mapLoadingLeaving = false;

    const now = Date.now();
    this.mapLoadingShownAt = now;
    this.mapLoadingMinUntil = now + this.OVERLAY_MIN_SHOW_MS;

    this.lockIfHasDirections();

    const st: any = history.state;
    if (st?.lat && st?.lng) {
      this.userLat = st.lat;
      this.userLng = st.lng;
    }

    const first = await this.mapService.getInitialPosition(15000);
    if (first) {
      this.userLat = first.lat;
      this.userLng = first.lng;
      this.hasUserFix = true;
    } else {
      this.hasUserFix = false;
    }

    this.mapService.initializeMap(this.userLat, this.userLng, 'map');
    this.mapService.setNavigationMode(false);
    this.applyMapSettings();
    await this.mapService.startGpsWatch(false, 18);
    void this.checkOutsideAfterTiles(9000);
  }

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

    await new Promise((res) => setTimeout(res, durationMs));
    await loading.dismiss();
  }

  private resetForNewSelection() {
    this.navigationActive = false;
    this.hasArrived = false;

    this.mapService.setNavigationMode(false);
    this.mapService.setFollowUser(false);

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.removeRouting(true);

    this.routeReady = false;
    this.hasRoutePreview = false;
    this.outsideCampus = false;

    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;
    this.popupMeters = null;
    this.popupEtaMin = null;

    this.maneuvers = [];
    this.prevFix = null;
    this.lastRouteIndex = 0;
    this.lastProgressAt = 0;
    this.lastNavAt = 0;
    this.lastHereForProgress = null;

    this.resetTopNav();

    this.selectionLocked = false;
    this.lockIfHasDirections();
  }

  async toggleAmea() {
    this.ameaEnabled = !this.ameaEnabled;

    await this.uiDialog.info(
      'DIALOG.AMEA_TITLE',
      this.ameaEnabled ? 'DIALOG.AMEA_ON_MSG' : 'DIALOG.AMEA_OFF_MSG'
    );

    if (this.currentDestination && (this.routeReady || this.navigationActive || this.hasRoutePreview)) {
      await this.onDirections(); 
    }
  }

  async openSettings() {
    const modal = await this.modalCtrl.create({
      component: SettingsModalComponent,
      cssClass: 'app-dialog-modal',
      componentProps: {
        value: await this.settingsSvc.load(), 
        onRefreshMap: async () => this.refreshMapNow(),
      },
    });

    await modal.present();

    const { role } = await modal.onDidDismiss();
    if (role === 'refreshMap') {
      await this.refreshMapNow();
    }
  }

  private async refreshMapNow() {
  // 1) Leaflet resize fix (πολύ σημαντικό μετά από modals)
  this.mapService.invalidateSizeSafe?.();

  // 2) Force redraw tiles (πραγματικό refresh)
  await this.mapService.refreshBaseLayer?.();

  // 3) μικρό delay για repaint
  await new Promise(r => setTimeout(r, 120));

  // 4) ξανά invalidate
  this.mapService.invalidateSizeSafe?.();
}


  private etaFromMeters(m: number): number {
    const metersPerMinute = 78;
    return Math.max(1, Math.ceil(m / metersPerMinute));
  }

  private setDistanceUiFromDirect(start: L.LatLng, end: L.LatLng) {
    const direct = Math.max(0, Math.ceil(start.distanceTo(end)));
    this.routeTotalMeters = direct;
    this.routeRemainingMeters = direct;
    this.popupMeters = direct;
    this.popupEtaMin = this.etaFromMeters(direct);
  }

  private bearing(a: L.LatLng, b: L.LatLng) {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const toDeg = (x: number) => (x * 180) / Math.PI;

    const lat1 = toRad(a.lat),
      lat2 = toRad(b.lat);
    const dLng = toRad(b.lng - a.lng);

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

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

    const hintPoint = Math.min(points.length - 1, Math.max(0, this.lastRouteIndex + 1));
    const { idx: closest } = this.findClosestIndexFast(currentPoint, points, hintPoint);

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

    const next = this.maneuvers.find((m) => m.i > closest);
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

  private subscribeToMapEvents() {
    const loadSub = (this.mapService as any).mapLoadingProgress?.subscribe?.(
      ({ loading, progress }: { loading: boolean; progress: number }) => {
        const isLoading = !!loading;

        this.mapLoading = isLoading;
        this.mapLoadingPct = Math.max(0, Math.min(100, Math.round(progress ?? 0)));

        if (isLoading) {
          if (this.mapLoadingOffTimer) {
            clearTimeout(this.mapLoadingOffTimer);
            this.mapLoadingOffTimer = null;
          }
          if (this.mapLoadingMinTimer) {
            clearTimeout(this.mapLoadingMinTimer);
            this.mapLoadingMinTimer = null;
          }
          const now = Date.now();
          if (!this.mapLoadingVisible) {
            this.mapLoadingShownAt = now;
            this.mapLoadingMinUntil = now + this.OVERLAY_MIN_SHOW_MS;
          }

          this.mapLoadingVisible = true;
          this.mapLoadingLeaving = false;
          this.lockIfHasDirections();
          return;
        }

        const now = Date.now();
        const waitMin = Math.max(0, this.mapLoadingMinUntil - now);

        if (waitMin > 0) {
          if (this.mapLoadingMinTimer) clearTimeout(this.mapLoadingMinTimer);
          this.mapLoadingMinTimer = setTimeout(() => {
            this.mapLoadingMinTimer = null;

            this.mapLoadingLeaving = true;
            this.lockIfHasDirections();

            if (this.mapLoadingOffTimer) clearTimeout(this.mapLoadingOffTimer);
            this.mapLoadingOffTimer = setTimeout(() => {
              this.mapLoadingOffTimer = null;
              this.mapLoadingVisible = false;
              this.mapLoadingLeaving = false;
              this.lockIfHasDirections();
            }, this.OVERLAY_FADE_MS);
          }, waitMin);

          this.mapLoadingVisible = true;
          this.mapLoadingLeaving = false;
          this.lockIfHasDirections();
          return;
        }
        
        this.mapLoadingLeaving = true;
        this.lockIfHasDirections();

        if (this.mapLoadingOffTimer) clearTimeout(this.mapLoadingOffTimer);
        this.mapLoadingOffTimer = setTimeout(() => {
          this.mapLoadingOffTimer = null;
          this.mapLoadingVisible = false;
          this.mapLoadingLeaving = false;
          this.lockIfHasDirections();
        }, this.OVERLAY_FADE_MS);
      }
    );

    const locSub = this.mapService.locationFound.subscribe((pos) => {
      this.userLat = pos.lat;
      this.userLng = pos.lng;
      this.hasUserFix = true;

      const inside = (this.mapService as any).isPointInsideCampusLoose
        ? (this.mapService as any).isPointInsideCampusLoose(pos.lat, pos.lng, 45)
        : this.mapService.isPointInsideCampus(pos.lat, pos.lng);

      this.outsideCampusKnown = true;
      this.outsideCampusOverlay = !inside;

      if (!this.navigationActive) return;

      const route = this.mapService.getCurrentRoutePoints();
      if (!route || route.length < 2) return;

      const here = L.latLng(pos.lat, pos.lng);

      if (this.lastHereForProgress && here.distanceTo(this.lastHereForProgress) < this.HERE_MIN_MOVE_M) {
        return;
      }

      if (this.prevFix) {
        const heading = this.bearing(this.prevFix, here);
        this.mapService.setUserHeading(heading);
      }
      this.prevFix = here;

      const now = Date.now();
      const canProgress = now - this.lastProgressAt >= this.PROGRESS_MIN_INTERVAL_MS;

      if (canProgress) {
        const split = this.buildProgressSplit(here, route);
        if (split) {
          this.mapService.updateRouteProgress(split.passed, split.remaining);
          this.lastProgressAt = now;
          this.lastHereForProgress = here;
        }
      }

      if (now - this.lastNavAt >= this.NAV_MIN_INTERVAL_MS) {
        this.updateNavInstruction(here, route);
        this.lastNavAt = now;
      }

      const last = route[route.length - 1];
      if (here.distanceTo(last) <= 25) {
        this.navigationActive = false;
        this.hasArrived = true;

        this.mapService.setFollowUser(false);
        this.mapService.setNavigationMode(false);

        this.resetTopNav();

        this.routeReady = false;
        this.selectionLocked = false;
        this.lockIfHasDirections();
      }
    });

    const errSub = this.mapService.locationError.subscribe(() => {});

    const outSub = this.mapService.outsideCampusClick.subscribe(async () => {
      if (this.selectionLocked) return;
      if (this.mapLoadingVisible) return;
      await this.uiDialog.info('DIALOG.OUTSIDE_CAMPUS_TITLE', 'DIALOG.OUTSIDE_CAMPUS_PICK_DEPT_MSG');
    });

    const clickSub = this.mapService.mapClicked.subscribe((data) => {
      if (this.selectionLocked) return;
      if (this.mapLoadingVisible) return;
      if (this.isSearchOpen) return;

      const fallbackName = this.translate.instant('DEST.CUSTOM.NAME') || 'Επιλεγμένος προορισμός';
      const name = data.name || fallbackName;

      void this.handleMapClick(data.lat, data.lng, name);
    });

    const progSub = this.mapService.routeProgress.subscribe((p) => {
      if (!this.navigationActive && !this.routeReady && !this.hasRoutePreview) return;

      this.routeTotalMeters = Math.max(0, Math.ceil(p.totalMeters));
      this.routeRemainingMeters = Math.max(0, Math.ceil(p.remainingMeters));

      if (this.navigationActive) {
        this.popupMeters = this.routeRemainingMeters;
        this.popupEtaMin = this.etaFromMeters(this.routeRemainingMeters);
      } else {
        this.popupMeters = this.routeTotalMeters;
        this.popupEtaMin = this.etaFromMeters(this.routeTotalMeters);
      }
    });

    if (loadSub) this.mapSubscriptions.push(loadSub);
    this.mapSubscriptions.push(locSub, errSub, outSub, clickSub, progSub);
  }

  async onDestinationSelected(destination: Destination) {
    if (this.selectionLocked) return;
    if (this.mapLoadingVisible) return;
    void this.handleMapClick(destination.lat, destination.lng, destination.name);
  }

  onSearchOpenChange(open: boolean) {
    this.isSearchOpen = open;
  }

  async handleMapClick(lat: number, lng: number, name: string = 'Επιλεγμένος προορισμός') {
    const ok = await this.ensureUnlockedOrCancel();
    if (!ok) return;

    this.resetForNewSelection();

    const found = this.destinationList.find((d) => d.name === name);
    const dest: Destination = found ? found : { id: 'CUSTOM', name, lat, lng };
    this.currentDestination = dest;

    this.hasArrived = false;

    const inside = (this.mapService as any).isPointInsideCampusLoose
      ? (this.mapService as any).isPointInsideCampusLoose(this.userLat, this.userLng, 45)
      : this.mapService.isPointInsideCampus(this.userLat, this.userLng);

    this.outsideCampus = !inside;

    const centerLL = L.latLng(dest.lat, dest.lng);

    this.mapService.pinDestination(centerLL.lat, centerLL.lng, dest.name);
    this.mapService.focusOn(centerLL.lat, centerLL.lng, 19);

    if (!this.hasUserFix || !inside) {
      this.routeTotalMeters = 0;
      this.routeRemainingMeters = 0;
      this.popupMeters = null;   // -> "—"
      this.popupEtaMin = null;   // -> "—"
    } else {
      const startLL = L.latLng(this.userLat, this.userLng);
      this.setDistanceUiFromDirect(startLL, centerLL);
    }


    this.routeReady = false;
    this.navigationActive = false;
    this.lockIfHasDirections();

    this.showModal = true;
  }


  async onDirections() {
    if (!this.currentDestination) return;

    const inside = (this.mapService as any).isPointInsideCampusLoose
      ? (this.mapService as any).isPointInsideCampusLoose(this.userLat, this.userLng, 45)
      : this.mapService.isPointInsideCampus(this.userLat, this.userLng);

    this.outsideCampus = !inside;
    if (this.outsideCampus) {
      await this.uiDialog.info('DIALOG.ROUTE_FROM_BUSSTOP_TITLE', 'DIALOG.ROUTE_FROM_BUSSTOP_MSG');
    }

    const startLL = inside ? L.latLng(this.userLat, this.userLng) : this.BUS_STOP;

    this.mapService.removeRouting(true);
    await this.mapService.drawCustomRouteToDestination(this.currentDestination, startLL, {
      wheelchair: this.ameaEnabled,
    });


    const routePts = this.mapService.getCurrentRoutePoints();
    if (routePts && routePts.length >= 2) {
      this.maneuvers = this.buildManeuvers(routePts);

      const meters = Math.max(0, Math.ceil(this.mapService.getCurrentRouteDistanceMeters()));
      if (meters > 0) {
        this.routeTotalMeters = meters;
        this.routeRemainingMeters = meters;
        this.popupMeters = meters;
        this.popupEtaMin = this.etaFromMeters(meters);
      }

      this.routeReady = true;
      this.hasRoutePreview = false;

      this.lockIfHasDirections();
      this.resetTopNav();
      this.onFitRoute();
    } else {
      this.routeReady = false;
      this.lockIfHasDirections();
    }
  }

  async startNavigation() {
    if (!this.currentDestination) return;

    const inside = (this.mapService as any).isPointInsideCampusLoose
      ? (this.mapService as any).isPointInsideCampusLoose(this.userLat, this.userLng, 45)
      : this.mapService.isPointInsideCampus(this.userLat, this.userLng);

    this.outsideCampus = !inside;
    if (this.outsideCampus) return;

    if (!this.routeReady) {
      await this.onDirections();
    }
    if (!this.routeReady) return;

    await this.presentLoadingKey('LOADING.ROUTE_LOADING');

    this.mapService.setNavigationMode(true);
    this.hasArrived = false;

    const destLat = this.currentDestination.entranceLat ?? this.currentDestination.lat;
    const destLng = this.currentDestination.entranceLng ?? this.currentDestination.lng;
    this.mapService.pinDestination(destLat, destLng, this.currentDestination.name);

    this.mapService.setFollowUser(true, 19);
    this.mapService.recenterToUser({ zoom: 19, follow: true, animate: true });

    this.navEnabled = true;
    this.navigationActive = true;

    this.lockIfHasDirections();

    const route = this.mapService.getCurrentRoutePoints();
    this.prevFix = null;
    this.lastRouteIndex = 0;
    this.lastProgressAt = 0;
    this.lastNavAt = 0;
    this.lastHereForProgress = null;

    this.updateNavInstruction(L.latLng(this.userLat, this.userLng), route);
  }

  cancelRouteKeepPopup() {
    this.navigationActive = false;
    this.hasArrived = false;

    this.mapService.setNavigationMode(false);
    this.mapService.setFollowUser(false);

    if (this.simulationInterval) clearInterval(this.simulationInterval);

    const dest = this.currentDestination;

    this.mapService.removeRouting(true);

    if (dest) {
      const centerLL = L.latLng(dest.lat, dest.lng);
      this.mapService.pinDestination(centerLL.lat, centerLL.lng, dest.name);
      this.mapService.focusOn(centerLL.lat, centerLL.lng, 19);
    }

    this.routeReady = false;
    this.hasRoutePreview = false;

    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    this.resetTopNav();
    this.showModal = true;

    this.maneuvers = [];
    this.prevFix = null;
    this.lastRouteIndex = 0;
    this.lastProgressAt = 0;
    this.lastNavAt = 0;
    this.lastHereForProgress = null;

    this.selectionLocked = false;
    this.lockIfHasDirections();
  }

  onPopupClose() {
    this.showModal = false;

    this.popupHeightPx = 0;
    this.popupRO?.disconnect();
    this.popupRO = undefined;
    this.popupObservedEl = null;

    this.navigationActive = false;
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.mapService.setNavigationMode(false);
    this.mapService.setFollowUser(false);
    this.mapService.removeRouting();

    this.routeReady = false;
    this.hasRoutePreview = false;
    this.outsideCampus = false;

    this.hasArrived = false;
    this.currentDestination = null;

    this.resetTopNav();

    this.routeTotalMeters = 0;
    this.routeRemainingMeters = 0;

    this.popupMeters = null;
    this.popupEtaMin = null;

    this.maneuvers = [];

    this.prevFix = null;
    this.lastRouteIndex = 0;
    this.lastProgressAt = 0;
    this.lastNavAt = 0;
    this.lastHereForProgress = null;

    this.selectionLocked = false;
    this.lockIfHasDirections();
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
      try {
        anyMap.refreshMap();
      } catch {}
    } else {
      try {
        (anyMap.map ?? null)?.invalidateSize?.(true);
      } catch {}
    }

    await new Promise((res) => setTimeout(res, 900));
    clearInterval(tick);
    loading.message = this.translate.instant('LOADING.MAP_REFRESHING', { pct: 100 });
    await new Promise((res) => setTimeout(res, 250));
    await loading.dismiss();
  }

  private findClosestIndexFast(
    here: L.LatLng,
    route: L.LatLng[],
    hintIndex: number
  ): { idx: number; bestDistM: number } {
    if (!route || route.length === 0) return { idx: 0, bestDistM: Infinity };

    const n = route.length;
    const hint = Math.max(0, Math.min(n - 1, hintIndex || 0));

    const lo = Math.max(0, hint - this.WINDOW_BACK);
    const hi = Math.min(n - 1, hint + this.WINDOW_FWD);

    let bestIdx = hint;
    let best = Infinity;

    for (let i = lo; i <= hi; i++) {
      const d = here.distanceTo(route[i]);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }

    if (best > this.FULLSCAN_TRIGGER_M) {
      let b2 = best;
      let i2 = bestIdx;
      for (let i = 0; i < n; i++) {
        const d = here.distanceTo(route[i]);
        if (d < b2) {
          b2 = d;
          i2 = i;
        }
      }
      return { idx: i2, bestDistM: b2 };
    }

    return { idx: bestIdx, bestDistM: best };
  }

  private projectOnSegment(
    here: L.LatLng,
    a: L.LatLng,
    b: L.LatLng
  ): { pt: L.LatLng; t: number; distM: number } {
    const P = L.CRS.EPSG3857.project(here);
    const A = L.CRS.EPSG3857.project(a);
    const B = L.CRS.EPSG3857.project(b);

    const abx = B.x - A.x;
    const aby = B.y - A.y;
    const apx = P.x - A.x;
    const apy = P.y - A.y;

    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-9) {
      const d = Math.hypot(P.x - A.x, P.y - A.y);
      return { pt: a, t: 0, distM: d };
    }

    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));

    const cx = A.x + t * abx;
    const cy = A.y + t * aby;

    const distM = Math.hypot(P.x - cx, P.y - cy);
    const pt = L.CRS.EPSG3857.unproject(L.point(cx, cy));
    return { pt, t, distM };
  }

  private pushOrReplaceClose(arr: L.LatLng[], p: L.LatLng, minM = 0.25) {
    if (arr.length === 0) {
      arr.push(p);
      return;
    }
    const last = arr[arr.length - 1];
    if (last.distanceTo(p) <= minM) {
      arr[arr.length - 1] = p;
    } else {
      arr.push(p);
    }
  }

  private buildProgressSplit(
    here: L.LatLng,
    route: L.LatLng[]
  ): { passed: L.LatLng[]; remaining: L.LatLng[]; bestDistM: number } | null {
    if (!route || route.length < 2) return null;

    let seg = Math.max(0, Math.min(route.length - 2, this.lastRouteIndex || 0));

    const MAX_OFFROUTE_M = 40;
    const NODE_REACH_M = 6;

    const SHORT_SEG_M = 12;
    const SHORT_T_REACH = 0.85;

    const projectSeg = (s: number) => this.projectOnSegment(here, route[s], route[s + 1]);

    let pr = projectSeg(seg);

    if (pr.distM > MAX_OFFROUTE_M) {
      const hintPoint = Math.min(route.length - 1, Math.max(0, seg + 1));
      const { idx, bestDistM } = this.findClosestIndexFast(here, route, hintPoint);
      const newSeg = Math.max(0, Math.min(route.length - 2, idx - 1));
      seg = Math.max(seg, newSeg);
      pr = projectSeg(seg);

      if (bestDistM > 80) return null;
    }

    while (seg < route.length - 2) {
      const a = route[seg];
      const b = route[seg + 1];
      const segLen = a.distanceTo(b);

      const reached =
        segLen <= SHORT_SEG_M ? pr.t >= SHORT_T_REACH : here.distanceTo(b) <= NODE_REACH_M;

      if (!reached) break;

      seg += 1;
      pr = projectSeg(seg);
    }

    this.lastRouteIndex = seg;

    const passed: L.LatLng[] = [];
    const remaining: L.LatLng[] = [];

    passed.push(...route.slice(0, seg + 1));
    this.pushOrReplaceClose(passed, pr.pt);

    remaining.push(pr.pt);
    const tail = route.slice(seg + 1);

    if (tail.length > 0) {
      if (remaining[0].distanceTo(tail[0]) <= 0.25) {
        remaining[0] = tail[0];
        remaining.push(...tail.slice(1));
      } else {
        remaining.push(...tail);
      }
    }

    return { passed, remaining, bestDistM: pr.distM };
  }

  get canFitRoute(): boolean {
    const pts = this.mapService.getCurrentRoutePoints();
    return !!pts && pts.length >= 2;
  }

  onFitRoute() {
    const bottomPad = 260 + (this.showModal ? this.popupHeightPx || 0 : 0);

    (this.mapService as any).fitRouteToView?.({
      paddingTopLeft: [30, 140],
      paddingBottomRight: [30, bottomPad],
      maxZoom: 18,
      animate: true,
    });
  }
}
