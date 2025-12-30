import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

export type AppLanguage = 'el' | 'en';
export type UnitsMode = 'm' | 'km';
export type BaseLayerMode = 'osm' | 'maptiler';

export interface AppSettings {
  // Γενικά
  language: AppLanguage;  
  units: UnitsMode;        // m ή km
  northLock: boolean;      // κλείδωμα βορρά (north up)
  baseLayer: BaseLayerMode;// OSM / MapTiler
}

const KEY = 'unimap_settings_v2';

const DEFAULTS: AppSettings = {
  language: 'el',
  units: 'm',
  northLock: false,
  baseLayer: 'maptiler',
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  defaults(): AppSettings {
    return { ...DEFAULTS };
  }

  async load(): Promise<AppSettings> {
    const { value } = await Preferences.get({ key: KEY });
    if (!value) return { ...DEFAULTS };

    try {
      const parsed = JSON.parse(value);
      return { ...DEFAULTS, ...parsed } as AppSettings;
    } catch {
      return { ...DEFAULTS };
    }
  }

  async save(s: AppSettings): Promise<void> {
    await Preferences.set({ key: KEY, value: JSON.stringify(s) });
  }

  async reset(): Promise<AppSettings> {
    await Preferences.remove({ key: KEY });
    return { ...DEFAULTS };
  }
}
