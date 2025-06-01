import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController, Platform } from '@ionic/angular';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false
})
export class SplashPage {
  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private platform: Platform
  ) {}

  async getLocationAndGo() {
    let lat = 40.657230;  // 🔁 fallback ΔΙΠΑΕ
    let lng = 22.804656;

    try {
      // ✅ Αν είμαστε σε κινητό
      if (this.platform.is('capacitor') || this.platform.is('android') || this.platform.is('ios')) {
        const perm = await Geolocation.requestPermissions();
        if (perm.location !== 'granted') throw new Error('Permission denied');
      }

      const position = await Geolocation.getCurrentPosition();
      lat = position.coords.latitude;
      lng = position.coords.longitude;
      console.log(`📍 Real position: ${lat}, ${lng}`);
    } catch (err) {
      console.warn('⚠️ Χρήση fallback τοποθεσίας.', err);
    }

    this.router.navigate(['/home'], {
      state: { lat, lng }
    });
  }
}
