export interface Destination {
  id: string;       
  name: string;       
  lat: number;
  lng: number;
  entranceLat?: number;
  entranceLng?: number;
  image?: string;
  description?: string; 
  phone?: string;
  website?: string; 
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export const destinationList: Destination[] = [
  {
    id: 'MAIEUTIKI',
    name: 'Τμήμα Μαιευτικής',
    lat: 40.65749725294477,
    lng: 22.80582768425436,
    entranceLat: 40.657423,
    entranceLng: 22.805801,
    image: 'assets/images/departments/maieutiki.jpg',
    description:
      'Το Τμήμα Μαιευτικής προσφέρει υψηλού επιπέδου εκπαίδευση στη φροντίδα της γυναίκας και του νεογνού.',
    phone: '2310013843',
    website : 'https://www.ihu.gr/tmima-maieftikis/',
    bounds: {
      north: 40.65777326555862,
      south: 40.65705680374365,
      east: 22.80619695674264,
      west: 22.805390576278832,
    },
  },

  {
    id: 'NURSING',
    name: 'Τμήμα Νοσηλευτικής',
    lat: 40.657512259067374,
    lng: 22.805006877643027,
    entranceLat: 40.65744,
    entranceLng: 22.805002,
    image: 'assets/images/departments/dipae_logo.png',
    description: 'Εκπαίδευση και πρακτική στη φροντίδα υγείας και τη νοσηλευτική επιστήμη.',
    phone: '2310013824',
    website: 'https://www.nurse.ihu.gr/%CF%84%CE%BC%CE%AE%CE%BC%CE%B1-%CE%BD%CE%BF%CF%83%CE%B7%CE%BB%CE%B5%CF%85%CF%84%CE%B9%CE%BA%CE%AE%CF%82/',
    bounds: {
      north: 40.65777160324301,
      south: 40.65714490735149,
      east: 22.80529854371273,
      west: 22.80468718461109,
    },
  },

  {
    id: 'PHYSIO',
    name: 'Τμήμα Φυσικοθεραπείας',
    lat: 40.657488597710554,
    lng: 22.804320695658898,
    entranceLat: 40.657452,
    entranceLng: 22.804278,
    image: 'assets/images/departments/phyciotherapy.jpg',
    description: 'Σπουδές στην αποκατάσταση και θεραπεία κινητικών δυσλειτουργιών.',
    phone: '2310013802',
    website: 'https://phys.ihu.gr/',
    bounds: {
      north: 40.65777160324365,
      south: 40.6571814786269,
      east: 22.804676228348686,
      west: 22.803920246663868,
    },
  },

  {
    id: 'DIETETICS',
    name: 'Τμήμα Διατροφής και Διαιτολογίας',
    lat: 40.658154624342295,
    lng: 22.803683105931498,
    entranceLat: 40.658006430808285,
    entranceLng: 22.803597743580113,
    image: 'assets/images/departments/diaitologia.jpg',
    description: 'Ασχολείται με τη διατροφή, την υγιεινή και την πρόληψη παθήσεων μέσω της δίαιτας.',
    phone: '2310013900',
    website: 'https://nutr.ihu.gr/el/',
    bounds: {
      north: 40.65832332551336,
      south: 40.657902219448545,
      east: 22.803882225197363,
      west: 22.803486702151677,
    },
  },

  {
    id: 'AGRONOMY',
    name: 'Τμήμα Γεωπονίας',
    lat: 40.658483817912305,
    lng:  22.80371325120134,
    entranceLat: 40.658552,
    entranceLng: 22.803704,
    image: 'assets/images/departments/geoponias.jpg',
    description: 'Σπουδές στη γεωπονία, διαχείριση φυσικών πόρων και αγροτική παραγωγή.',
    phone: '2310013862',
    website: 'https://www.agro.ihu.gr/',
    bounds: {
      north: 40.658563211461626,
      south: 40.658381873851155,
      east: 22.804035278603152,
      west: 22.803383688928058,
    },
  },

  {
    id: 'FOOD_TECH',
    name: 'Τμήμα Επιστήμης και Τεχνολογίας Τροφίμων',
    lat: 40.655996934639994,
    lng: 22.802312853374616,
    entranceLat: 40.65585974854294,
    entranceLng: 22.802158248369402,
    image: 'assets/images/departments/texnologia_trofimwn.jpg',
    description: 'Μελέτη της παραγωγής και ελέγχου ποιότητας τροφίμων.',
    phone: '2310013908',
    website: 'https://www.food.ihu.gr/',
  
    bounds: {
      north: 40.65615312676459,
      south: 40.65580193437832,
      east: 22.80254434974311,
      west: 22.802129029071942,
    },
  },

  {
    id: 'MPD_VEHICLES',
    name: 'Τμήμα Μηχανικών Παραγωγής και Διοίκησης (Παράρτημα Οχημάτων)',
    lat: 40.65542234468539,
    lng: 22.80319602368392,
    entranceLat: 40.65552063447767,
    entranceLng: 22.803255064657716,
    image: 'assets/images/departments/oximatwn.jpg',
    description: 'Εξειδίκευση στη μελέτη και διαχείριση μηχανοκίνητων οχημάτων και παραγωγικών διαδικασιών.',
    phone: '2310013939',
    website: 'https://www.iem.ihu.gr/',
    bounds: {
      north: 40.65558532912994,
      south: 40.65519112860029,
      east: 22.80350543890108,
      west: 22.80289022817632,
    },
  },

  {
    id: 'CS_BUILDING_H',
    name: 'Τμήμα Μηχανικών Πληροφορικής (Κτήριο Η)',
    lat: 40.655467886331,
    lng: 22.80587503575322,
    entranceLat: 40.6556801165255,
    entranceLng: 22.8057602909593,
    image: 'assets/images/departments/ilektronikis.jpg',
    description: 'Καινοτόμα έρευνα και εφαρμογές στον τομέα της πληροφορικής.',
    phone: '2310013621',
    website : 'https://www.iee.ihu.gr/',
    bounds: {
      north: 40.655744513978334,
      south: 40.655155846219564,
      east: 22.806469245292412,
      west: 22.8056366998561,
    },
  },

  {
    id: 'CS_BUILDING_P',
    name: 'Τμήμα Μηχανικών Πληροφορικής (Κτήριο Π)',
    lat: 40.656001630173606,
    lng: 22.804052777323523,
    entranceLat: 40.65587753014149,
    entranceLng: 22.804064757176615,
    image: 'assets/images/departments/Ktirio_pliroforikis.jpg',
    description: 'Προγραμματισμός, τεχνητή νοημοσύνη και σύγχρονες υπολογιστικές τεχνολογίες.',
    phone: '2310013621',
    website: 'https://www.iee.ihu.gr/',
    bounds: {
      north: 40.65607925374713,
      south: 40.65589920105018,
      east: 22.8044453540746,
      west: 22.803769854435533,
    },
  },

  {
    id: 'SDO',
    name: 'Τμήμα Διοίκησης Οργανισμών, Μάρκετινγκ και Τουρισμού',
    lat: 40.656897284456505,
    lng: 22.80372884206972,
    entranceLat: 40.65718391160669,
    entranceLng: 22.803757375002238,
    image: 'assets/images/departments/sdo.jpg',
    description: 'Σπουδές στη διοίκηση οργανισμών, μάρκετινγκ και τουρισμού.',
    phone: '2310013756',
    website: 'https://ommt.ihu.gr/',
    bounds: {
      north: 40.657191867988715,
      south: 40.656646544466795,
      east: 22.8038522328527,
      west: 22.803650995698128,
    },
  },

  {
    id: 'LIS',
    name: 'Τμήμα Βιβλιοθηκονομίας, Αρχειονομίας & Συστημάτων Πληροφόρησης',
    lat: 40.657455215554,
    lng: 22.80348788974662,
    entranceLat: 40.6572426564661,
    entranceLng: 22.803505173997745,
    image: 'assets/images/departments/dipae_logo.png',
    description: 'Τμήμα Βιβλιοθηκονομίας και συστημάτων πληροφόρησης.',
    phone: '2310013185',
    website: 'https://www.lisa.ihu.gr/',
    bounds: {
      north: 40.65764482920283,
      south: 40.657194828366016,
      east: 22.803635189994434,
      west: 22.803348746587012,
    },
  },

  {
    id: 'ENV_ENGINEERING',
    name: 'Τμήμα Μηχανικών Περιβάλλοντος',
    lat: 40.65654685255857,
    lng: 22.802870614893244,
    entranceLat: 40.656512671672225,
    entranceLng: 22.802679487255652,
    image: 'assets/images/departments/dipae_logo.png',
    description: 'Σπουδές στη μηχανική περιβάλλοντος.',
    phone: '2310013934',
    website: 'https://env.ihu.gr/',
    bounds: {
      north: 40.65664102138373,
      south: 40.65628077985187,
      east: 22.80322134626219,
      west: 22.802591883026672,
    },
  },

  {
    id: 'ACCOUNTING_IS',
    name: 'Τμήμα Λογιστικής και Πληροφοριακών Συστημάτων',
    lat: 40.656515612057085,
    lng: 22.804099329099017,
    entranceLat: 40.656488,
    entranceLng: 22.803707,
    image: 'assets/images/departments/dipae_logo.png',
    description: 'Σπουδές στη λογιστική και τα πληροφοριακά συστήματα.',
    phone: '2310013192',
    website: 'https://www.accis.ihu.gr/',
    bounds: {
      north: 40.65661190413269,
      south: 40.656384742896115,
      east: 22.804424234084674,
      west: 22.80363490711706,
    },
  },
];
