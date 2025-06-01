import { Geolocation } from '@capacitor/geolocation';

(async () => {
  try {
    const permission = await Geolocation.requestPermissions();
    console.log('🔐 Permission:', permission);

    const position = await Geolocation.getCurrentPosition();
    console.log('📍 Position:', position.coords);
  } catch (error) {
    console.error('❌ Geolocation Error:', error);
  }

})();

