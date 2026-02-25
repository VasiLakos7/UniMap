import { Component, AfterViewInit, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Platform } from '@ionic/angular';

import { NativeSettings, AndroidSettings } from 'capacitor-native-settings';

import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { SettingsService, AppLanguage } from '../services/settings.service';
import { NavController } from '@ionic/angular';

import { Network } from '@capacitor/network';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit, AfterViewInit, OnDestroy {
  loading = false;

  typedText = '';
  fullText = '';
  typingDone = false;
  private typingTimeout: any;
  private i = 0;

  // Network
  netOnline = true;
  private netListener?: PluginListenerHandle;
  private netPollTimer: any = null;

  // Status
  statusKey: string | null = null;
  statusMode: 'none' | 'offline' | 'permission' | 'gps' | 'error' = 'none';

  private langSub?: Subscription;

  // Premium notification banner (top)
  bannerVisible = false;
  bannerLeaving = false;
  bannerKey: string | null = null;
  private bannerTimer: any = null;
  private bannerSeq = 0;

  constructor(
    private router: Router,
    private platform: Platform,
    private translate: TranslateService,
    private settingsSvc: SettingsService,
    private navCtrl: NavController
  ) {}

  async ngOnInit() {
    await this.initNetwork();
  }

  ngAfterViewInit() {
    this.applyWelcomeTextAndRestartTyping();

    this.langSub = this.translate.onLangChange.subscribe(() => {
      this.applyWelcomeTextAndRestartTyping();
    });
  }

  ngOnDestroy() {
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.langSub?.unsubscribe();

    this.netListener?.remove();
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);

    if (this.netPollTimer) {
      clearInterval(this.netPollTimer);
      this.netPollTimer = null;
    }

    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer);
      this.bannerTimer = null;
    }
  }

  // -------------------------
  // Network handling
  // -------------------------
  private async initNetwork() {
    await this.refreshNetOnline();

    if (!this.netOnline) {
      this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
    }

    // listener (native)
    try {
      this.netListener = await Network.addListener('networkStatusChange', (st) => {
        const prev = this.netOnline;
        this.netOnline = !!st.connected;

        if (!this.netOnline) {
          this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
          return;
        }

        // offline -> online
        if (!prev && this.netOnline) {
          if (this.statusMode === 'offline') this.clearStatus();
          this.showBanner('SPLASH.TOAST.BACK_ONLINE');
        }
      });
    } catch {
      // web fallback
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }

    // fallback που πιάνει ΠΑΝΤΑ αλλαγές
    this.startNetPolling(1000);
  }

  private onOnline = () => {
    const prev = this.netOnline;
    this.netOnline = true;

    if (!prev) {
      if (this.statusMode === 'offline') this.clearStatus();
      this.showBanner('SPLASH.TOAST.BACK_ONLINE');
    }
  };

  private onOffline = () => {
    this.netOnline = false;
    this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
  };

  private async refreshNetOnline() {
    try {
      const st = await Network.getStatus();
      this.netOnline = !!st.connected;
    } catch {
      this.netOnline = navigator.onLine;
    }
  }

  private startNetPolling(ms = 1200) {
    if (this.netPollTimer) return;

    this.netPollTimer = setInterval(async () => {
      const prev = this.netOnline;
      await this.refreshNetOnline();

      if (prev !== this.netOnline) {
        if (!this.netOnline) {
          this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
        } else {
          if (this.statusMode === 'offline') this.clearStatus();
          this.showBanner('SPLASH.TOAST.BACK_ONLINE');
        }
      }
    }, ms);
  }

  // -------------------------
  // Premium notification banner (slide in + fade out)
  // -------------------------
  private showBanner(key: string, holdMs = 1400) {
    this.bannerSeq++;
    const seq = this.bannerSeq;

    this.bannerKey = key;
    this.bannerVisible = true;
    this.bannerLeaving = false;

    if (this.bannerTimer) clearTimeout(this.bannerTimer);

    // μένει λίγο και μετά φεύγει “σιγά-σιγά”
    this.bannerTimer = setTimeout(() => {
      if (seq !== this.bannerSeq) return;

      this.bannerLeaving = true;

      // πρέπει να ταιριάζει με CSS (bannerOut 650ms)
      setTimeout(() => {
        if (seq !== this.bannerSeq) return;
        this.bannerVisible = false;
        this.bannerLeaving = false;
      }, 650);
    }, holdMs);
  }

  // -------------------------
  // Language + typing
  // -------------------------
  async toggleLanguage() {
    const s = await this.settingsSvc.load();
    const next: AppLanguage = s.language === 'el' ? 'en' : 'el';

    await this.settingsSvc.save({ ...s, language: next });
    await firstValueFrom(this.translate.use(next));
  }

  private applyWelcomeTextAndRestartTyping() {
    this.fullText = this.translate.instant('SPLASH.WELCOME');

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce) {
      this.typedText = this.fullText;
      this.typingDone = true;
      return;
    }
    this.startTyping();
  }

  private startTyping() {
    this.i = 0;
    this.typedText = '';
    this.typingDone = false;

    if (this.typingTimeout) clearTimeout(this.typingTimeout);

    const base = 95;
    const jitter = 70;

    const tick = () => {
      this.typedText += this.fullText.charAt(this.i);
      this.i++;

      if (this.i >= this.fullText.length) {
        this.typingDone = true;
        this.typingTimeout = null;
        return;
      }

      const last = this.fullText.charAt(this.i - 1);
      const extra = last === ' ' ? 110 : last === '.' || last === ',' ? 260 : 0;

      this.typingTimeout = setTimeout(tick, base + Math.floor(Math.random() * jitter) + extra);
    };

    this.typingTimeout = setTimeout(tick, 350);
  }

  // -------------------------
  // Native settings helpers (Android only)
  // -------------------------
  private isAndroidNative(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  async openAppSettings() {
    try {
      if (this.isAndroidNative()) {
        await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
        return;
      }
    } catch {}
  }

  async openLocationSettings() {
    try {
      if (this.isAndroidNative()) {
        await NativeSettings.openAndroid({ option: AndroidSettings.Location });
        return;
      }
    } catch {}
  }

  // -------------------------
  // Status logic (offline priority)
  // -------------------------
  private setStatus(mode: 'offline' | 'permission' | 'gps' | 'error', key: string) {
    if (!this.netOnline || mode === 'offline') {
      this.statusMode = 'offline';
      this.statusKey = 'SPLASH.STATUS.NO_INTERNET';
      return;
    }

    this.statusMode = mode;
    this.statusKey = key;
  }

  private clearStatus() {
    this.statusMode = 'none';
    this.statusKey = null;
  }

  // -------------------------
  // Main flow: Location + go
  // -------------------------
  async getLocationAndGo() {
    if (this.loading) return;
    this.loading = true;
    this.clearStatus();

    try {
      await this.platform.ready();

      // πριν κάνεις GPS/permissions: έλεγξε internet
      await this.refreshNetOnline();
      if (!this.netOnline) {
        this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
        return;
      }

      const st: any = await Geolocation.checkPermissions();
      let granted = st?.location === 'granted' || st?.coarseLocation === 'granted';

      if (!granted) {
        const req: any = await Geolocation.requestPermissions();
        granted = req?.location === 'granted' || req?.coarseLocation === 'granted';
      }

      if (!granted) {
        this.setStatus('permission', 'SPLASH.STATUS.PERMISSION_DENIED');
        return;
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      this.navCtrl.navigateRoot('/home', { animated: false });
    } catch (e: any) {
      // αν στο ενδιάμεσο έπεσε internet, δείξε ΜΟΝΟ offline
      await this.refreshNetOnline();
      if (!this.netOnline) {
        this.setStatus('offline', 'SPLASH.STATUS.NO_INTERNET');
        return;
      }

      const code = Number(e?.code);
      const msg = String(e?.message ?? e ?? '').toLowerCase();

      // Permission denied
      if (code === 1 || msg.includes('permission') || msg.includes('denied')) {
        this.setStatus('permission', 'SPLASH.STATUS.PERMISSION_DENIED');
        return;
      }

      // GPS off / unavailable / timeout
      const gpsLike =
        code === 2 ||
        code === 3 ||
        msg.includes('location services') ||
        msg.includes('disabled') ||
        msg.includes('turned off') ||
        msg.includes('position unavailable') ||
        msg.includes('timeout') ||
        (msg.includes('location') && (msg.includes('off') || msg.includes('unavailable')));

      if (gpsLike) {
        this.setStatus('gps', 'SPLASH.STATUS.GPS_OFF');
        return;
      }

      this.setStatus('error', 'SPLASH.STATUS.ERROR_GENERIC');
    } finally {
      this.loading = false;
    }
  }
}
