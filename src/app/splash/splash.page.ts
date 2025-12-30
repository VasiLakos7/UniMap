import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController, Platform } from '@ionic/angular';

import { NativeSettings, AndroidSettings, IOSSettings } from 'capacitor-native-settings';

import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { SettingsService, AppLanguage } from '../services/settings.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false
})
export class SplashPage implements AfterViewInit, OnDestroy {
  loading = false;

  typedText = '';
  fullText = '';
  typingDone = false;
  private typingTimeout: any;
  private i = 0;

  // ✅ bottom status UI
  statusKey: string | null = null;
  statusMode: 'none' | 'permission' | 'gps' | 'error' = 'none';

  private langSub?: Subscription;

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private platform: Platform,
    private translate: TranslateService,
    private settingsSvc: SettingsService
  ) {}

  ngAfterViewInit() {
    this.applyWelcomeTextAndRestartTyping();

    this.langSub = this.translate.onLangChange.subscribe(() => {
      this.applyWelcomeTextAndRestartTyping();
    });
  }

  ngOnDestroy() {
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.langSub?.unsubscribe();
  }

  async toggleLanguage() {
    const s = await this.settingsSvc.load();
    const next: AppLanguage = (s.language === 'el') ? 'en' : 'el';

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
      const extra = last === ' ' ? 110 : (last === '.' || last === ',') ? 260 : 0;

      this.typingTimeout = setTimeout(tick, base + Math.floor(Math.random() * jitter) + extra);
    };

    this.typingTimeout = setTimeout(tick, 350);
  }

  private isAndroidNative(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  private isIOSNative(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  }

  // ✅ ανοίγει App settings (άδειες UniMap)
  async openAppSettings() {
    try {
      if (this.isAndroidNative()) {
        await NativeSettings.openAndroid({ option: AndroidSettings.ApplicationDetails });
        return;
      }
      if (this.isIOSNative()) {
        await NativeSettings.openIOS({ option: IOSSettings.App });
        return;
      }
    } catch {}
  }

  // ✅ ανοίγει Location settings (GPS toggle)
  async openLocationSettings() {
    try {
      if (this.isAndroidNative()) {
        await NativeSettings.openAndroid({ option: AndroidSettings.Location });
        return;
      }
      if (this.isIOSNative()) {
        await NativeSettings.openIOS({ option: IOSSettings.LocationServices });
        return;
      }
    } catch {}
  }

  private setStatus(mode: 'permission' | 'gps' | 'error', key: string) {
    this.statusMode = mode;
    this.statusKey = key;
  }

  private clearStatus() {
    this.statusMode = 'none';
    this.statusKey = null;
  }

  private async showGenericAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({ header, message, buttons: ['ΟΚ'] });
    await alert.present();
  }

  async getLocationAndGo() {
    if (this.loading) return;
    this.loading = true;
    this.clearStatus();

    try {
      await this.platform.ready();

      const st: any = await Geolocation.checkPermissions();
      let granted =
        st?.location === 'granted' ||
        st?.coarseLocation === 'granted';

      if (!granted) {
        const req: any = await Geolocation.requestPermissions();
        granted =
          req?.location === 'granted' ||
          req?.coarseLocation === 'granted';
      }

      if (!granted) {
        this.setStatus('permission', 'SPLASH.STATUS.PERMISSION_DENIED');
        return;
      }

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      this.router.navigate(['/home'], { state: { lat, lng } });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '').toLowerCase();

      // GPS / Location services off
      if (
        msg.includes('location') &&
        (msg.includes('disabled') || msg.includes('off') || msg.includes('turned off'))
      ) {
        this.setStatus('gps', 'SPLASH.STATUS.GPS_OFF');
        return;
      }

      this.setStatus('error', 'SPLASH.STATUS.ERROR_GENERIC');

    } finally {
      this.loading = false;
    }
  }
}
