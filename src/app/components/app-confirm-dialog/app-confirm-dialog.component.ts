import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  standalone: true,
  selector: 'app-confirm-dialog',
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <ion-content class="appDialog" [fullscreen]="true">
      <div class="card">
        <ion-icon class="icon" [name]="icon"></ion-icon>

        <div class="title">{{ titleKey | translate }}</div>
        <div class="msg" *ngIf="messageKey">{{ messageKey | translate }}</div>

        <div class="btnRow">
          <ion-button expand="block" fill="outline" (click)="cancel()">
            {{ cancelKey | translate }}
          </ion-button>

          <ion-button expand="block" color="primary" (click)="confirm()">
            {{ confirmKey | translate }}
          </ion-button>
        </div>
      </div>
    </ion-content>
  `,
  styleUrls: ['./app-confirm-dialog.component.scss'],
})
export class AppConfirmDialogComponent {
  @Input() titleKey!: string;
  @Input() messageKey?: string;
  @Input() icon: string = 'warning';

  @Input() cancelKey: string = 'DIALOG.CANCEL';
  @Input() confirmKey: string = 'DIALOG.OK';

  constructor(private modalCtrl: ModalController) {}

  cancel() {
    this.modalCtrl.dismiss(false, 'cancel');
  }
  confirm() {
    this.modalCtrl.dismiss(true, 'confirm');
  }
}
