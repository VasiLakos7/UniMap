import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { Geolocation } from '@capacitor/geolocation';
import { AlertController } from '@ionic/angular';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone:false
})
export class SplashPage {
  constructor(private router: Router, private alertCtrl: AlertController) {}

  async getLocationAndGo() {
    try {
      const position = await Geolocation.getCurrentPosition();
      const coords = position.coords;

      console.log('📍 Position:', coords);

      // Αν θες να περάσουμε τη θέση στο home:
      this.router.navigate(['/home'], {
        state: {
          lat: coords.latitude,
          lng: coords.longitude
        }
      });

    } catch (error) {
      console.error('❌ Geolocation error:', error);
      await this.showAlert('Σφάλμα', 'Δεν ήταν δυνατή η ανάκτηση τοποθεσίας.');
    }
  }

  async showAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }
}
