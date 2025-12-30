import { Component } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-privacy-modal',
  imports: [IonicModule, CommonModule],
  templateUrl: './privacy-modal.component.html',
  styleUrls: ['./privacy-modal.component.scss'],
})
export class PrivacyModalComponent {
  constructor(private modalCtrl: ModalController) {}
  close() { this.modalCtrl.dismiss(); }
}
