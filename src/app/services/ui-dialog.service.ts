import { Injectable } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { AppDialogComponent } from '../components/app-dialog/app-dialog.component';
import { AppConfirmDialogComponent } from '../components/app-confirm-dialog/app-confirm-dialog.component';

export type DialogKeyOptions = {
  titleKey: string;
  messageKey?: string;
  icon?: string;
};

@Injectable({ providedIn: 'root' })
export class UiDialogService {
  private presenting = false;

  constructor(private modalCtrl: ModalController) {}

  private async safeDismissTop() {
    try {
      const top = await this.modalCtrl.getTop();
      if (top) await top.dismiss().catch(() => {});
    } catch {}
  }

  async openKeys(opts: DialogKeyOptions) {
    if (this.presenting) {
      await this.safeDismissTop();
    }
    this.presenting = true;

    const modal = await this.modalCtrl.create({
      component: AppDialogComponent,
      componentProps: {
        titleKey: opts.titleKey,
        messageKey: opts.messageKey ?? '',
        icon: opts.icon ?? 'checkmark-circle',
      },
      backdropDismiss: false,
      cssClass: 'app-dialog-modal',
    });

    modal.onDidDismiss().then(() => (this.presenting = false));

    await modal.present();
    return modal.onDidDismiss();
  }

  settingsSaved() {
    return this.openKeys({
      titleKey: 'DIALOG.SETTINGS_CHANGED_TITLE',
      messageKey: 'DIALOG.SETTINGS_CHANGED_MSG',
      icon: 'checkmark-circle',
    });
  }


  info(titleKeyOrMessageKey: string, messageKey?: string) {
    if (messageKey == null) {
      return this.openKeys({
        titleKey: 'DIALOG.INFO_TITLE',
        messageKey: titleKeyOrMessageKey,
        icon: 'information-circle',
      });
    }
    return this.openKeys({ titleKey: titleKeyOrMessageKey, messageKey, icon: 'information-circle' });
  }

  error(titleKeyOrMessageKey: string, messageKey?: string) {
    if (messageKey == null) {
      return this.openKeys({
        titleKey: 'DIALOG.ERROR_TITLE',
        messageKey: titleKeyOrMessageKey,
        icon: 'alert-circle',
      });
    }
    return this.openKeys({ titleKey: titleKeyOrMessageKey, messageKey, icon: 'alert-circle' });
  }

  async confirmKeys(opts: {
    titleKey: string;
    messageKey?: string;
    icon?: string;
    cancelKey?: string;
    confirmKey?: string;
  }): Promise<boolean> {
    if (this.presenting) {
      await this.safeDismissTop();
    }
    this.presenting = true;

    const modal = await this.modalCtrl.create({
      component: AppConfirmDialogComponent,
      componentProps: {
        titleKey: opts.titleKey,
        messageKey: opts.messageKey ?? '',
        icon: opts.icon ?? 'warning',
        cancelKey: opts.cancelKey ?? 'DIALOG.CANCEL',
        confirmKey: opts.confirmKey ?? 'DIALOG.OK',
      },
      backdropDismiss: false,
      cssClass: 'app-dialog-modal',
    });

    modal.onDidDismiss().then(() => (this.presenting = false));

    await modal.present();
    const res = await modal.onDidDismiss();
    return res.data === true;
  }
}
