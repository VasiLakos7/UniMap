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
      // ✅ Έλεγχος αν είμαστε σε κινητό (Capacitor)
      if (this.platform.is('capacitor') || this.platform.is('android') || this.platform.is('ios')) {
        const perm = await Geolocation.requestPermissions();
        console.log('Permission status:', perm);
        if (perm.location !== 'granted') {
          throw new Error('Η άδεια τοποθεσίας δεν δόθηκε');
        }
      }

      // Λήψη τρέχουσας τοποθεσίας
      const position = await Geolocation.getCurrentPosition();
      lat = position.coords.latitude;
      lng = position.coords.longitude;
      console.log(`📍 Στην τοποθεσία: ${lat}, ${lng}`);
      
    } catch (err) {
      console.warn('⚠️ Χρήση fallback τοποθεσίας.', err);
      // Αν αποτύχει το GPS, να εμφανίζεται μήνυμα
      const alert = await this.alertCtrl.create({
        header: 'Σφάλμα',
        message: 'Δεν μπορούμε να εντοπίσουμε την τοποθεσία σας. Θα χρησιμοποιήσουμε την προεπιλεγμένη τοποθεσία.',
        buttons: ['OK']
      });
      await alert.present();
    }

    // Πλοήγηση στην επόμενη σελίδα με τις συντεταγμένες
    this.router.navigate(['/home'], {
      state: { lat, lng }
    });
  }
}
