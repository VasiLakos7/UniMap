import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController, Platform } from '@ionic/angular';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false
})
export class SplashPage implements AfterViewInit, OnDestroy {
  loading = false;

  // Typewriter (slow + human-like)
  typedText = '';
  fullText = 'Καλώς ήρθες στο campus του ΔΙΠΑΕ.';
  typingDone = false;

  private typingTimeout: any;
  private i = 0;

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private platform: Platform
  ) {}

  ngAfterViewInit() {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce) {
      this.typedText = this.fullText;
      this.typingDone = true;
      return;
    }
    this.startTyping();
  }

  ngOnDestroy() {
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
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
        this.typingDone = true; // ✅ κρύβουμε cursor στο τέλος
        this.typingTimeout = null;
        return;
      }

      const lastChar = this.fullText.charAt(this.i - 1);
      const extraPause =
        lastChar === ' ' ? 110 :
        lastChar === '.' || lastChar === ',' ? 260 :
        0;

      const delay = base + Math.floor(Math.random() * jitter) + extraPause;
      this.typingTimeout = setTimeout(tick, delay);
    };

    this.typingTimeout = setTimeout(tick, 350);
  }

  private async ensureLocationPermission(): Promise<boolean> {
    if (this.platform.is('capacitor') || this.platform.is('android') || this.platform.is('ios')) {
      const status = await Geolocation.checkPermissions();
      if (status.location === 'granted') return true;

      const req = await Geolocation.requestPermissions();
      return req.location === 'granted';
    }
    return true;
  }

  async getLocationAndGo() {
    this.loading = true;

    let lat = 40.657230; // fallback ΔΙΠΑΕ
    let lng = 22.804656;

    try {
      const ok = await this.ensureLocationPermission();
      if (!ok) throw new Error('Permission denied');

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });

      lat = position.coords.latitude;
      lng = position.coords.longitude;

      console.log('✅ GPS coords:', lat, lng, 'accuracy:', position.coords.accuracy);
    } catch (err: any) {
      console.warn('⚠️ Χρήση fallback τοποθεσίας.', err?.message || err);

      const alert = await this.alertCtrl.create({
        header: 'Δεν βρέθηκε τοποθεσία',
        message:
          'Άνοιξε το Location (GPS) και δώσε άδεια "Ακριβής τοποθεσία". Θα χρησιμοποιηθεί προσωρινά προεπιλεγμένη θέση.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.loading = false;
    }

    this.router.navigate(['/home'], { state: { lat, lng } });
  }
}
