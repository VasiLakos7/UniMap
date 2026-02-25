import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';

import { HttpClientModule, HttpClient } from '@angular/common/http';
import { TranslateLoader, TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, firstValueFrom } from 'rxjs';

import { SettingsService } from './services/settings.service';

export function createTranslateLoader(http: HttpClient): TranslateLoader {
  return {
    getTranslation: (lang: string): Observable<any> =>
      http.get(`assets/i18n/${lang}.json?v=${Date.now()}`)
  } as TranslateLoader;
}


// init language BEFORE app renders
export function initLanguage(settingsSvc: SettingsService, translate: TranslateService) {
  return async () => {
    translate.setDefaultLang('el');

    const s = await settingsSvc.load();
    const lang = s.language || 'el';
    translate.addLangs(['el', 'en']);
    await firstValueFrom(translate.use(lang));
  };
}

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,

    HttpClientModule,
    TranslateModule.forRoot({
      defaultLanguage: 'el',
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpClient],
      },
    }),
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
     {
    provide: APP_INITIALIZER,
    useFactory: initLanguage,
    deps: [SettingsService, TranslateService],
    multi: true,
    },

  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
