import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  standalone: true,
  selector: 'app-dialog',
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <ion-content class="appDialog" [fullscreen]="true">
      <div class="card">
        <ion-icon class="icon" [name]="icon"></ion-icon>

        <div class="title">{{ titleKey | translate }}</div>
        <div class="msg" *ngIf="messageKey">{{ messageKey | translate }}</div>

        <ion-button class="okBtn" expand="block" color="primary" (click)="close()">
          {{ 'DIALOG.OK' | translate }}
        </ion-button>
      </div>
    </ion-content>
  `,
  styleUrls: ['./app-dialog.component.scss'],
})
export class AppDialogComponent {
  @Input() titleKey!: string;
  @Input() messageKey?: string;
  @Input() icon: string = 'checkmark-circle';

  constructor(private modalCtrl: ModalController) {}

  close() {
    this.modalCtrl.dismiss(true, 'ok');
  }
}
