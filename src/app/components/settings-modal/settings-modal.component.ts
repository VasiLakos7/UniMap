import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';

import { AppSettings, SettingsService } from '../../services/settings.service';
import { PrivacyModalComponent } from '../privacy-modal/privacy-modal.component';

import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { UiDialogService } from '../../services/ui-dialog.service';


@Component({
  standalone: true,
  selector: 'app-settings-modal',
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.scss'],
  imports: [IonicModule, CommonModule, FormsModule, TranslateModule],
})
export class SettingsModalComponent implements OnInit {
  @Input() value?: AppSettings;

  draft: AppSettings;
  dirty = false;

  activeTab: 'general' | 'map' | 'support' = 'general';

  refreshing = false;
  refreshPct = 0;

  appVersion = '0.9.0';

  selectPopoverOpts = {
    cssClass: 'select-compact-popover',
    size: 'auto',
    side: 'bottom',
    alignment: 'end',
  };

  constructor(
    private modalCtrl: ModalController,
    private settingsSvc: SettingsService,
    private translate: TranslateService,
    private uiDialog: UiDialogService,
  ) {
    this.draft = this.settingsSvc.defaults();
  }

  async ngOnInit() {
    if (!this.value) {
      this.value = await this.settingsSvc.load();
    }

    this.draft = this.clone(this.value);
    this.dirty = false;
  }

  private clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  private equals(a: AppSettings, b: AppSettings): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  markDirty() {
    if (!this.value) return;
    this.dirty = !this.equals(this.draft, this.value);
  }

  close() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

      async save() {
      if (!this.value) return;

      try {
        this.value = this.clone(this.draft);

        await this.settingsSvc.save(this.value);
        await firstValueFrom(this.translate.use(this.value.language));

        this.dirty = false;

        // ✅ Παράθυρο μπροστά + tick + OK
        await this.uiDialog.settingsSaved();

        this.modalCtrl.dismiss(this.value, 'save');
      } catch (e) {
        await this.uiDialog.error('DIALOG.ERROR_TITLE', 'DIALOG.ERROR_SAVE_SETTINGS');
      }
    }

    async reset() {
      try {
        const fresh = await this.settingsSvc.reset();

        this.value = this.clone(fresh);
        this.draft = this.clone(fresh);

        await this.settingsSvc.save(this.value);
        await firstValueFrom(this.translate.use(this.value.language));

        this.dirty = false;

        await this.uiDialog.info('DIALOG.RESET_DONE_TITLE', 'DIALOG.RESET_DONE_MSG');

        this.modalCtrl.dismiss(this.value, 'reset');
      } catch (e) {
        await this.uiDialog.error('DIALOG.ERROR_TITLE', 'DIALOG.ERROR_RESET');
      }
    }


  requestRefreshMap() {
    this.modalCtrl.dismiss(null, 'refreshMap');
  }

    sendFeedback() {
      const to = 'billrantzos@gmail.com';

      const subject = encodeURIComponent(this.translate.instant('SUPPORT.EMAIL_SUBJECT'));
      const body = encodeURIComponent(
        this.translate.instant('SUPPORT.EMAIL_BODY', { appVersion: this.appVersion })
      );

      window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
    }

  async openPrivacy() {
    const modal = await this.modalCtrl.create({
      component: PrivacyModalComponent,
      breakpoints: [0, 0.5, 0.85],
      initialBreakpoint: 0.85,
      cssClass: 'privacy-modal',
    });
    await modal.present();
  }
}
