import { Component } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

@Component({
  standalone: true,
  selector: 'app-privacy-modal',
  imports: [IonicModule, CommonModule,TranslateModule],
  templateUrl: './privacy-modal.component.html',
  styleUrls: ['./privacy-modal.component.scss'],
})
export class PrivacyModalComponent {
  constructor(private modalCtrl: ModalController) {}
  close() { this.modalCtrl.dismiss(); }
}
