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

  async ionViewDidEnter() {
    try {
      // Ζήτα άδεια
      const perm = await Geolocation.requestPermissions();
      if (perm.location === 'granted') {
        // Πάρε τοποθεσία
        const position = await Geolocation.getCurrentPosition();
        console.log('Current position:', position.coords.latitude, position.coords.longitude);

        // Αποθήκευσε την τοποθεσία ή στείλε στην αρχική
        this.router.navigateByUrl('/home');
      } else {
        await this.showAlert('Άδεια Απαραίτητη', 'Χρειάζεται άδεια τοποθεσίας για να συνεχίσετε.');
      }
    } catch (error) {
      console.error('Geolocation error:', error);
      await this.showAlert('Σφάλμα', 'Δεν ήταν δυνατή η ανάκτηση τοποθεσίας.');
    }
  }

  async showAlert(header: string, message: string) {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: ['ΟΚ']
    });
    await alert.present();
  }
}
