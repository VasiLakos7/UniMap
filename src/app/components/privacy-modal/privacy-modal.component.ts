import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Browser } from '@capacitor/browser';

@Component({
  standalone: true,
  selector: 'app-privacy-modal',
  templateUrl: './privacy-modal.component.html',
  styleUrls: ['./privacy-modal.component.scss'],
  imports: [CommonModule, IonicModule, TranslateModule],
})
export class PrivacyModalComponent {
  osmCopyrightUrl = 'https://www.openstreetmap.org/copyright';

  storedKeys = [
    'PRIVACY.STORED.ITEMS.UNITS',
    'PRIVACY.STORED.ITEMS.LAYER',
    'PRIVACY.STORED.ITEMS.NORTH_LOCK',
  ];


  constructor(private modalCtrl: ModalController) {}

  close() {
    this.modalCtrl.dismiss();
  }

  async openLink(url: string) {
    try {
      await Browser.open({ url });
    } catch {
      window.open(url, '_blank');
    }
  }

}
