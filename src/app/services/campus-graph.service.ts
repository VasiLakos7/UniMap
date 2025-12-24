import { Injectable } from '@angular/core';
import { find_path } from 'dijkstrajs';
import * as L from 'leaflet';

// ----------------------------------------------------
// 1) OSM GRAPH (auto-generated) — base network
// ----------------------------------------------------
const OSM_NODE_COORDS: Record<string, L.LatLng> = {
  N0001: L.latLng(40.658525, 22.799298),
  N0002: L.latLng(40.658459, 22.799296),
  N0003: L.latLng(40.658354, 22.799355),
  N0004: L.latLng(40.658187, 22.799542),
  N0005: L.latLng(40.657899, 22.79992),
  N0006: L.latLng(40.657445, 22.800354),
  N0007: L.latLng(40.656817, 22.800956),
  N0008: L.latLng(40.656757, 22.801019),
  N0009: L.latLng(40.656715, 22.801081),
  N0010: L.latLng(40.657342, 22.805804),
  N0011: L.latLng(40.657168, 22.805803),
  N0012: L.latLng(40.656951, 22.804577),
  N0013: L.latLng(40.656879, 22.804575),
  N0014: L.latLng(40.656723, 22.804572),
  N0015: L.latLng(40.656553, 22.804567),
  N0016: L.latLng(40.656389, 22.804563),
  N0017: L.latLng(40.656257, 22.80456),
  N0018: L.latLng(40.657116, 22.803215),
  N0019: L.latLng(40.657113, 22.803203),
  N0020: L.latLng(40.65709, 22.803172),
  N0021: L.latLng(40.657081, 22.803169),
  N0022: L.latLng(40.656886, 22.803168),
  N0023: L.latLng(40.656695, 22.803168),
  N0024: L.latLng(40.656686, 22.803172),
  N0025: L.latLng(40.656664, 22.803201),
  N0026: L.latLng(40.656661, 22.803213),
  N0027: L.latLng(40.656661, 22.80347),
  N0028: L.latLng(40.656665, 22.803484),
  N0029: L.latLng(40.656685, 22.803508),
  N0030: L.latLng(40.656695, 22.803513),
  N0031: L.latLng(40.657077, 22.803524),
  N0032: L.latLng(40.65709, 22.80351),
  N0033: L.latLng(40.657114, 22.803477),
  N0034: L.latLng(40.657116, 22.803466),
  N0035: L.latLng(40.657116, 22.8033),
  N0036: L.latLng(40.657213, 22.803699),
  N0037: L.latLng(40.657216, 22.803551),
  N0038: L.latLng(40.657221, 22.803305),
  N0039: L.latLng(40.656718, 22.805035),
  N0040: L.latLng(40.656878, 22.805037),
  N0041: L.latLng(40.657873, 22.803176),
  N0042: L.latLng(40.657871, 22.803309),
  N0043: L.latLng(40.657869, 22.803432),
  N0044: L.latLng(40.657866, 22.803666),
  N0045: L.latLng(40.657854, 22.804547),
  N0046: L.latLng(40.656382, 22.80503),
  N0047: L.latLng(40.657751, 22.803663),
  N0048: L.latLng(40.657657, 22.803669),
  N0049: L.latLng(40.65752, 22.803696),
  N0050: L.latLng(40.657367, 22.803716),
  N0051: L.latLng(40.657266, 22.803712),
  N0052: L.latLng(40.658683, 22.803325),
  N0053: L.latLng(40.658249, 22.803323),
  N0054: L.latLng(40.657655, 22.803313),
  N0055: L.latLng(40.656677, 22.803502),
  N0056: L.latLng(40.656645, 22.803562),
  N0057: L.latLng(40.656634, 22.803593),
  N0058: L.latLng(40.656574, 22.803619),
  N0059: L.latLng(40.65584, 22.803614),
  N0060: L.latLng(40.655735, 22.803614),
  N0061: L.latLng(40.657144, 22.803551),
  N0062: L.latLng(40.657045, 22.803526),
  N0063: L.latLng(40.657048, 22.803693),
  N0064: L.latLng(40.657161, 22.806069),
  N0065: L.latLng(40.657173, 22.805625),
  N0066: L.latLng(40.65718, 22.805375),
  N0067: L.latLng(40.657191, 22.804995),
  N0068: L.latLng(40.655745, 22.801974),
  N0069: L.latLng(40.655728, 22.804402),
  N0070: L.latLng(40.658084, 22.801779),
  N0071: L.latLng(40.658079, 22.802211),
  N0072: L.latLng(40.658083, 22.802228),
  N0073: L.latLng(40.658089, 22.802242),
  N0074: L.latLng(40.658097, 22.802256),
  N0075: L.latLng(40.658107, 22.802267),
  N0076: L.latLng(40.658118, 22.802275),
  N0077: L.latLng(40.65813, 22.802281),
  N0078: L.latLng(40.658143, 22.802284),
  N0079: L.latLng(40.65869, 22.802269),
  N0080: L.latLng(40.655666, 22.802067),
  N0081: L.latLng(40.65562, 22.802114),
  N0082: L.latLng(40.655231, 22.802544),
  N0083: L.latLng(40.655212, 22.802575),
  N0084: L.latLng(40.655191, 22.802609),
  N0085: L.latLng(40.655168, 22.802664),
  N0086: L.latLng(40.655155, 22.802723),
  N0087: L.latLng(40.655122, 22.803504),
  N0088: L.latLng(40.655105, 22.803893),
  N0089: L.latLng(40.655095, 22.804261),
  N0090: L.latLng(40.655079, 22.804582),
  N0091: L.latLng(40.655068, 22.804765),
  N0092: L.latLng(40.655055, 22.804928),
  N0093: L.latLng(40.655042, 22.805125),
  N0094: L.latLng(40.655032, 22.805378),
  N0095: L.latLng(40.656224, 22.805365),
  N0096: L.latLng(40.655709, 22.805354),
  N0097: L.latLng(40.658666, 22.80189),
  N0098: L.latLng(40.658666, 22.801864),
  N0099: L.latLng(40.658665, 22.801842),
  N0100: L.latLng(40.65866, 22.801822),
  N0101: L.latLng(40.65865, 22.801804),
  N0102: L.latLng(40.658637, 22.801796),
  N0103: L.latLng(40.658623, 22.801789),
  N0104: L.latLng(40.658604, 22.801784),
  N0105: L.latLng(40.65858, 22.801782),
  N0106: L.latLng(40.658228, 22.801776),
  N0107: L.latLng(40.65867, 22.805386),
  N0108: L.latLng(40.658675, 22.804534),
  N0109: L.latLng(40.658686, 22.8029),

  // αυτά είναι off-campus (θα φιλτραριστούν από bbox)
  N0110: L.latLng(40.652598, 22.801264),
  N0111: L.latLng(40.652683, 22.801196),
  N0112: L.latLng(40.652723, 22.801173),
  N0113: L.latLng(40.652767, 22.801157),
  N0114: L.latLng(40.652811, 22.801156),
  N0115: L.latLng(40.653321, 22.801236),
  N0116: L.latLng(40.653679, 22.8012),
  N0117: L.latLng(40.653772, 22.801205),
  N0118: L.latLng(40.654047, 22.801199),
  N0119: L.latLng(40.654074, 22.8012),
  N0120: L.latLng(40.654102, 22.801191),
  N0121: L.latLng(40.654162, 22.801142),
  N0122: L.latLng(40.654173, 22.801114),
  N0123: L.latLng(40.654175, 22.801077),

  N0124: L.latLng(40.658034, 22.804551),
  N0125: L.latLng(40.657998, 22.804551),
  N0126: L.latLng(40.656307, 22.805366),
  N0127: L.latLng(40.657071, 22.805373),
  N0128: L.latLng(40.657373, 22.805375),
  N0129: L.latLng(40.655789, 22.804621),
  N0130: L.latLng(40.655831, 22.804851),
  N0131: L.latLng(40.655887, 22.80503),
  N0132: L.latLng(40.655988, 22.805175),
  N0133: L.latLng(40.657045, 22.801683),
  N0134: L.latLng(40.657041, 22.801811),
  N0135: L.latLng(40.656007, 22.801802),
  N0136: L.latLng(40.655937, 22.801812),
  N0137: L.latLng(40.655887, 22.801834),
  N0138: L.latLng(40.655845, 22.801868),
  N0139: L.latLng(40.655786, 22.801922),
  N0140: L.latLng(40.656239, 22.804574),
  N0141: L.latLng(40.656223, 22.804593),
  N0142: L.latLng(40.656211, 22.804616),
  N0143: L.latLng(40.656202, 22.804641),
  N0144: L.latLng(40.656198, 22.804669),
  N0145: L.latLng(40.656204, 22.805027),
};

const OSM_EDGES: Array<[string, string]> = [
  ['N0001', 'N0002'],
  ['N0002', 'N0003'],
  ['N0003', 'N0004'],
  ['N0004', 'N0005'],
  ['N0005', 'N0006'],
  ['N0006', 'N0007'],
  ['N0007', 'N0008'],
  ['N0008', 'N0009'],
  ['N0010', 'N0011'],
  ['N0012', 'N0013'],
  ['N0013', 'N0014'],
  ['N0014', 'N0015'],
  ['N0015', 'N0016'],
  ['N0016', 'N0017'],
  ['N0018', 'N0019'],
  ['N0020', 'N0021'],
  ['N0021', 'N0022'],
  ['N0022', 'N0023'],
  ['N0023', 'N0024'],
  ['N0025', 'N0026'],
  ['N0026', 'N0027'],
  ['N0027', 'N0028'],
  ['N0029', 'N0030'],
  ['N0030', 'N0031'],
  ['N0031', 'N0032'],
  ['N0033', 'N0034'],
  ['N0034', 'N0035'],
  ['N0035', 'N0018'],
  ['N0036', 'N0037'],
  ['N0037', 'N0038'],
  ['N0014', 'N0039'],
  ['N0013', 'N0040'],
  ['N0041', 'N0042'],
  ['N0042', 'N0043'],
  ['N0043', 'N0044'],
  ['N0044', 'N0045'],
  ['N0016', 'N0046'],
  ['N0044', 'N0047'],
  ['N0047', 'N0048'],
  ['N0048', 'N0049'],
  ['N0049', 'N0050'],
  ['N0050', 'N0051'],
  ['N0051', 'N0036'],
  ['N0052', 'N0053'],
  ['N0053', 'N0042'],
  ['N0042', 'N0054'],
  ['N0054', 'N0038'],
  ['N0038', 'N0035'],
  ['N0055', 'N0056'],
  ['N0056', 'N0057'],
  ['N0057', 'N0058'],
  ['N0058', 'N0059'],
  ['N0059', 'N0060'],
  ['N0037', 'N0061'],
  ['N0061', 'N0031'],
  ['N0031', 'N0062'],
  ['N0062', 'N0063'],
  ['N0063', 'N0036'],
  ['N0064', 'N0011'],
  ['N0011', 'N0065'],
  ['N0065', 'N0066'],
  ['N0066', 'N0067'],
  ['N0067', 'N0036'],
  ['N0068', 'N0060'], // <-- θα σπάσει με chain
  ['N0060', 'N0069'], // <-- θα σπάσει με chain
  ['N0070', 'N0071'],
  ['N0071', 'N0072'],
  ['N0072', 'N0073'],
  ['N0073', 'N0074'],
  ['N0074', 'N0075'],
  ['N0075', 'N0076'],
  ['N0076', 'N0077'],
  ['N0077', 'N0078'],
  ['N0078', 'N0079'],
  ['N0068', 'N0080'],
  ['N0080', 'N0081'],
  ['N0081', 'N0082'],
  ['N0082', 'N0083'],
  ['N0083', 'N0084'],
  ['N0084', 'N0085'],
  ['N0085', 'N0086'],
  ['N0086', 'N0087'],
  ['N0087', 'N0088'],
  ['N0088', 'N0089'],
  ['N0089', 'N0090'],
  ['N0090', 'N0091'],
  ['N0091', 'N0092'],
  ['N0092', 'N0093'],
  ['N0093', 'N0094'],
  ['N0095', 'N0096'],
  ['N0096', 'N0094'],
  ['N0079', 'N0097'],
  ['N0097', 'N0098'],
  ['N0098', 'N0099'],
  ['N0099', 'N0100'],
  ['N0100', 'N0101'],
  ['N0101', 'N0102'],
  ['N0102', 'N0103'],
  ['N0103', 'N0104'],
  ['N0104', 'N0105'],
  ['N0105', 'N0106'],
  ['N0106', 'N0070'],
  ['N0107', 'N0108'],
  ['N0108', 'N0052'], // <-- θα σπάσει με chain
  ['N0052', 'N0109'],
  ['N0109', 'N0079'],
  ['N0110', 'N0111'],
  ['N0111', 'N0112'],
  ['N0112', 'N0113'],
  ['N0113', 'N0114'],
  ['N0114', 'N0115'],
  ['N0115', 'N0116'],
  ['N0116', 'N0117'],
  ['N0117', 'N0118'],
  ['N0118', 'N0119'],
  ['N0119', 'N0120'],
  ['N0120', 'N0121'],
  ['N0121', 'N0122'],
  ['N0122', 'N0123'],
  ['N0069', 'N0096'],
  ['N0124', 'N0125'],
  ['N0095', 'N0126'],
  ['N0126', 'N0127'],
  ['N0127', 'N0066'],
  ['N0066', 'N0128'],
  ['N0128', 'N0107'],
  ['N0069', 'N0129'],
  ['N0129', 'N0130'],
  ['N0130', 'N0131'],
  ['N0131', 'N0132'],
  ['N0132', 'N0095'],
  ['N0133', 'N0134'],
  ['N0134', 'N0135'],
  ['N0135', 'N0136'],
  ['N0136', 'N0137'],
  ['N0137', 'N0138'],
  ['N0138', 'N0139'],
  ['N0139', 'N0068'],
  ['N0017', 'N0140'],
  ['N0140', 'N0141'],
  ['N0141', 'N0142'],
  ['N0142', 'N0143'],
  ['N0143', 'N0144'],
  ['N0144', 'N0145'],
];

// ----------------------------------------------------
// 2) POIs / Entrances (semantic nodes)
// ----------------------------------------------------
const POI_NODE_COORDS: Record<string, L.LatLng> = {
  MAIEUTIKI_ENT: L.latLng(40.657423, 22.805801),
  NURSING_ENT: L.latLng(40.657440, 22.805002),
  PHYSIO_ENT: L.latLng(40.657452, 22.804278),
  DIET_DIET_ENT: L.latLng(40.658006430808285, 22.803597743580113),
  TROFIMON_ENT: L.latLng(40.65585974854294, 22.802158248369402),
  MPD_OXIMATA_ENT: L.latLng(40.65552063447767, 22.803255064657716),
  INF_H_ENT: L.latLng(40.6556801165255, 22.8057602909593),
  INF_P_ENT: L.latLng(40.65587753014149, 22.804064757176615),
  SDO_ENT: L.latLng(40.65718391160669, 22.803757375002238),
  LIB_ENT: L.latLng(40.6572426564661, 22.803505173997745),
  ENV_ENT: L.latLng(40.656512671672225, 22.802679487255652),
  LOG_ENT: L.latLng(40.656488, 22.803707),
  GEOPONIA_ENT: L.latLng(40.658552, 22.803704),
};

// ----------------------------------------------------
// 2.5) MANUAL ROAD NODES + EDGES
// ----------------------------------------------------
const MANUAL_NODE_COORDS: Record<string, L.LatLng> = {
  // μετά το N0026
  M_CENT_PRE_1: L.latLng(40.656662, 22.803098),
  M_CENTRAL: L.latLng(40.65666, 22.802577),

  // “πάνω διάδρομος” (κουμπώνει στο N0075)
  M_TOP1_TO_75_1: L.latLng(40.658065, 22.802323), // ανάμεσα M_TOP_1 και N0075
  M_TOP_1: L.latLng(40.658071, 22.80258),
  M_TOP_2: L.latLng(40.657862, 22.802583),
  M_TOP_3: L.latLng(40.657638, 22.802572),
  M_TOP_4: L.latLng(40.657553, 22.802575),
  M_TOP_5: L.latLng(40.657368, 22.802572),
  M_TOP_6: L.latLng(40.657089, 22.802575),
  M_TOP_7: L.latLng(40.657026, 22.802577),

  // είσοδοι σχολής
  M_SCHOOL_ENT_1: L.latLng(40.657362, 22.801816),
  M_SCHOOL_ENT_2: L.latLng(40.657657, 22.801708),

  // συνέχεια προς κάτω
  M_DOWN_1: L.latLng(40.656153, 22.802575),

  M_BOTTOM_MID: L.latLng(40.655737, 22.802588),

  // --- splits που είπες ---
  M_68_TO_BOTTOM_1: L.latLng(40.655738, 22.802178), // ανάμεσα N0068 και M_BOTTOM_MID
  M_BOTTOM_TO_60_1: L.latLng(40.65574083890454, 22.803266228597206), // ανάμεσα M_BOTTOM_MID και N0060
  M_60_TO_69_1: L.latLng(40.655726, 22.804071), // ανάμεσα N0060 και N0069
  M_0108_TO_0052_1: L.latLng(40.658673, 22.803712), // ανάμεσα N0108 και N0052
  M_58_TO_59_1: L.latLng(40.656482, 22.803623), // ανάμεσα N0058 και N0059
  M_36_TO_67_1: L.latLng(40.657202, 22.804278), //ανάμεσα N0036 και N0067s
  M_36_TO_67_PRE_1: L.latLng(40.657211397739765, 22.803763058404975), // ανάμεσα N0036 και M_36_TO_67_1
  M_CENTRAL_TO_DOWN_1: L.latLng(40.65650298153248, 22.802573043723065), // ανάμεσα M_CENTRAL και M_DOWN_1


};

const MANUAL_EDGES: Array<[string, string]> = [
  // N0026 -> (40.656662,22.803098) -> (40.656660,22.802577)
  ['N0026', 'M_CENT_PRE_1'],
  ['M_CENT_PRE_1', 'M_CENTRAL'],

  // N0075 -> (ενδιάμεσο) -> M_TOP_1 -> ... -> M_TOP_7 -> M_CENTRAL
  ['N0075', 'M_TOP1_TO_75_1'],
  ['M_TOP1_TO_75_1', 'M_TOP_1'],
  ['M_TOP_1', 'M_TOP_2'],
  ['M_TOP_2', 'M_TOP_3'],
  ['M_TOP_3', 'M_TOP_4'],
  ['M_TOP_4', 'M_TOP_5'],
  ['M_TOP_5', 'M_TOP_6'],
  ['M_TOP_6', 'M_TOP_7'],
  ['M_TOP_7', 'M_CENTRAL'],

  // κεντρικό -> M_DOWN_1 -> M_BOTTOM_MID
  ['M_CENTRAL', 'M_CENTRAL_TO_DOWN_1'],
  ['M_CENTRAL_TO_DOWN_1', 'M_DOWN_1'],

  ['M_DOWN_1', 'M_BOTTOM_MID'],

  // extra connections που είπες
  ['M_TOP_7', 'N0134'],
  ['M_TOP_6', 'N0020'],

  // branches προς είσοδο σχολής
  ['M_TOP_5', 'M_SCHOOL_ENT_1'],
  ['M_SCHOOL_ENT_1', 'N0134'],
  ['M_TOP_3', 'M_SCHOOL_ENT_2'],
];

// ----------------------------------------------------
// 3) Normalizer & alias
// ----------------------------------------------------
function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ΤΜΗΜΑ /g, '')
    .replace(/ΣΧΟΛΗ /g, '')
    .trim();
}

const alias = new Map<string, string>([
  ['ΜΑΙΕΥΤΙΚΗΣ', 'MAIEUTIKI_ENT'],
  ['ΝΟΣΗΛΕΥΤΙΚΗΣ', 'NURSING_ENT'],
  ['ΦΥΣΙΚΟΘΕΡΑΠΕΙΑΣ', 'PHYSIO_ENT'],
  ['ΔΙΑΤΡΟΦΗΣ ΚΑΙ ΔΙΑΙΤΟΛΟΓΙΑΣ', 'DIET_DIET_ENT'],

  ['ΕΠΙΣΤΗΜΗΣ ΚΑΙ ΤΕΧΝΟΛΟΓΙΑΣ ΤΡΟΦΙΜΩΝ', 'TROFIMON_ENT'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΑΡΑΓΩΓΗΣ ΚΑΙ ΔΙΟΙΚΗΣΗΣ (ΠΑΡΑΡΤΗΜΑ ΟΧΗΜΑΤΩΝ)', 'MPD_OXIMATA_ENT'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΛΗΡΟΦΟΡΙΚΗΣ (ΚΤΗΡΙΟ Η)', 'INF_H_ENT'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΛΗΡΟΦΟΡΙΚΗΣ (ΚΤΗΡΙΟ Π)', 'INF_P_ENT'],
  ['ΔΙΟΙΚΗΣΗΣ ΟΡΓΑΝΙΣΜΩΝ, ΜΑΡΚΕΤΙΝΓΚ ΚΑΙ ΤΟΥΡΙΣΜΟΥ', 'SDO_ENT'],
  ['ΒΙΒΛΙΟΘΗΚΟΝΟΜΙΑΣ, ΑΡΧΕΙΟΝΟΜΙΑΣ & ΣΥΣΤΗΜΑΤΩΝ ΠΛΗΡΟΦΟΡΗΣΗΣ', 'LIB_ENT'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΕΡΙΒΑΛΛΟΝΤΟΣ', 'ENV_ENT'],
  ['ΛΟΓΙΣΤΙΚΗΣ ΚΑΙ ΠΛΗΡΟΦΟΡΙΑΚΩΝ ΣΥΣΤΗΜΑΤΩΝ', 'LOG_ENT'],
  ['ΓΕΩΠΟΝΙΑΣ', 'GEOPONIA_ENT'],
]);

// ----------------------------------------------------
// 4) Build merged graph
// ----------------------------------------------------
type Adjacency = Record<string, Record<string, number>>;

function computeBBox(points: L.LatLng[]) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;

  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  return { minLat, maxLat, minLng, maxLng };
}

function inBBox(p: L.LatLng, bb: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  return p.lat >= bb.minLat && p.lat <= bb.maxLat && p.lng >= bb.minLng && p.lng <= bb.maxLng;
}

function addUndirectedEdge(g: Adjacency, coords: Record<string, L.LatLng>, u: string, v: string) {
  const a = coords[u];
  const b = coords[v];
  if (!a || !b) return;

  const w = Math.max(1, Math.round(a.distanceTo(b)));
  if (!g[u]) g[u] = {};
  if (!g[v]) g[v] = {};
  g[u][v] = Math.min(g[u][v] ?? Infinity, w);
  g[v][u] = Math.min(g[v][u] ?? Infinity, w);
}

function removeUndirectedEdge(g: Adjacency, u: string, v: string) {
  if (g[u]) delete g[u][v];
  if (g[v]) delete g[v][u];
}

function buildAdjacencyFromEdges(edges: Array<[string, string]>, coords: Record<string, L.LatLng>): Adjacency {
  const g: Adjacency = {};
  for (const [u, v] of edges) addUndirectedEdge(g, coords, u, v);
  return g;
}

function splitEdgeWithChain(
  g: Adjacency,
  coords: Record<string, L.LatLng>,
  a: string,
  b: string,
  chain: string[] // ενδιάμεσοι κόμβοι ΜΕ ΣΕΙΡΑ
) {
  removeUndirectedEdge(g, a, b);

  let prev = a;
  for (const mid of chain) {
    addUndirectedEdge(g, coords, prev, mid);
    prev = mid;
  }
  addUndirectedEdge(g, coords, prev, b);
}

function healCloseNodes(ids: string[], coords: Record<string, L.LatLng>, g: Adjacency, maxDistM: number) {
  for (let i = 0; i < ids.length; i++) {
    const aId = ids[i];
    const a = coords[aId];
    if (!a) continue;

    for (let j = i + 1; j < ids.length; j++) {
      const bId = ids[j];
      const b = coords[bId];
      if (!b) continue;

      const d = a.distanceTo(b);
      if (d <= maxDistM) addUndirectedEdge(g, coords, aId, bId);
    }
  }
}

function getLargestComponent(ids: string[], g: Adjacency): Set<string> {
  const seen = new Set<string>();
  let best = new Set<string>();

  for (const start of ids) {
    if (seen.has(start)) continue;

    const comp = new Set<string>();
    const stack = [start];
    seen.add(start);

    while (stack.length) {
      const u = stack.pop()!;
      comp.add(u);

      const nbrs = g[u] ? Object.keys(g[u]) : [];
      for (const v of nbrs) {
        if (!seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }

    if (comp.size > best.size) best = comp;
  }

  return best;
}

function findNearestNodeIdInSet(
  lat: number,
  lng: number,
  nodeIds: string[],
  coords: Record<string, L.LatLng>
): { id: string | null; distM: number } {
  const here = L.latLng(lat, lng);

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const id of nodeIds) {
    const c = coords[id];
    if (!c) continue;

    const d = here.distanceTo(c);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }

  return { id: bestId, distM: bestDist };
}

function mergeOSMWithPOIs() {
  // bbox από POIs + manual nodes (για να μη χάνονται περιοχές)
  const seedPoints = [...Object.values(POI_NODE_COORDS), ...Object.values(MANUAL_NODE_COORDS)];
  const bb0 = computeBBox(seedPoints);

  // ~150–250m margin
  const MARGIN = 0.0022;

  const bb = {
    minLat: bb0.minLat - MARGIN,
    maxLat: bb0.maxLat + MARGIN,
    minLng: bb0.minLng - MARGIN,
    maxLng: bb0.maxLng + MARGIN,
  };

  // 1) filter OSM nodes by bbox
  const keptOSM: Record<string, L.LatLng> = {};
  for (const [id, ll] of Object.entries(OSM_NODE_COORDS)) {
    if (inBBox(ll, bb)) keptOSM[id] = ll;
  }
  const keptOSMIds = Object.keys(keptOSM);

  // 2) filter edges to kept nodes
  const keptEdges: Array<[string, string]> = [];
  for (const [u, v] of OSM_EDGES) {
    if (keptOSM[u] && keptOSM[v]) keptEdges.push([u, v]);
  }

  // 3) merged coords = keptOSM + MANUAL + POIs
  const manualIds = Object.keys(MANUAL_NODE_COORDS);
  const ALL: Record<string, L.LatLng> = { ...keptOSM, ...MANUAL_NODE_COORDS, ...POI_NODE_COORDS };

  // 4) base adjacency from OSM
  const g = buildAdjacencyFromEdges(keptEdges, ALL);

  // 4.5) add manual edges (οι “χειροκίνητες” συνδέσεις σου)
  for (const [u, v] of MANUAL_EDGES) addUndirectedEdge(g, ALL, u, v);

  // ----------------------------------------------------
  // 4.6) APPLY SPLITS (για να περνάει από τα ενδιάμεσα σημεία)
  // ----------------------------------------------------

  // (A) N0068 <-> N0060: σπάει σε αλυσίδα
  splitEdgeWithChain(g, ALL, 'N0068', 'N0060', [
    'M_68_TO_BOTTOM_1',
    'M_BOTTOM_MID',
    'M_BOTTOM_TO_60_1',
  ]);

  // (B) N0060 <-> N0069: σπάει σε 2 κομμάτια
  splitEdgeWithChain(g, ALL, 'N0060', 'N0069', ['M_60_TO_69_1']);

  // (C) N0108 <-> N0052: σπάει σε 2 κομμάτια
  splitEdgeWithChain(g, ALL, 'N0108', 'N0052', ['M_0108_TO_0052_1']);

  // (D) N0058 <-> N0059: σπάει σε 2 κομμάτια
  splitEdgeWithChain(g, ALL, 'N0058', 'N0059', ['M_58_TO_59_1']);

  // (E) N0036 <-> N0067: σπάει σε 3 κομμάτια
  splitEdgeWithChain(g, ALL, 'N0036', 'N0067', ['M_36_TO_67_PRE_1','M_36_TO_67_1',]);


  



  // 5) heal small gaps on OSM+manual network
  const baseNetworkIds = [...keptOSMIds, ...manualIds];
  const HEAL_DIST = 6; // αν ξαναδείς NO PATH, ανέβασε σε 7–8
  healCloseNodes(baseNetworkIds, ALL, g, HEAL_DIST);

  // 6) largest component for stable snapping
  const largest = getLargestComponent(baseNetworkIds, g);
  const snapCandidates = baseNetworkIds.filter((id) => largest.has(id));

  // 7) snap POIs to nearest node in largest component
  const SNAP_MAX_METERS = 60;

  for (const [poiId, poiLL] of Object.entries(POI_NODE_COORDS)) {
    const { id: nearId, distM } = findNearestNodeIdInSet(poiLL.lat, poiLL.lng, snapCandidates, ALL);

    if (!nearId) {
      console.warn(`[CampusGraph] POI ${poiId} could not snap (no network candidates).`);
      continue;
    }

    if (distM > SNAP_MAX_METERS) {
      console.warn(
        `[CampusGraph] POI ${poiId} is ${Math.round(distM)}m away from nearest node ${nearId}. ` +
          `Consider increasing SNAP_MAX_METERS or improving data.`
      );
    }

    addUndirectedEdge(g, ALL, poiId, nearId);
  }

  return { coords: ALL, adjacency: g };
}

const MERGED = mergeOSMWithPOIs();

// ----------------------------------------------------
// 5) SERVICE
// ----------------------------------------------------
@Injectable({ providedIn: 'root' })
export class CampusGraphService {
  private readonly nodeCoords: Record<string, L.LatLng> = MERGED.coords;
  private readonly campusGraphData: Adjacency = MERGED.adjacency;

  public getNodeIdForName(destinationName: string): string | null {
    const key = norm(destinationName);
    return alias.get(key) ?? null;
  }

  public getDestinationCoords(nameOrId: string): L.LatLng | undefined {
    if (this.nodeCoords[nameOrId]) return this.nodeCoords[nameOrId];
    const id = this.getNodeIdForName(nameOrId);
    return id ? this.nodeCoords[id] : undefined;
  }

  public findNearestNodeId(lat: number, lng: number): string | null {
    const here = L.latLng(lat, lng);

    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const [id, ll] of Object.entries(this.nodeCoords)) {
      const d = here.distanceTo(ll);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }

    return bestId;
  }

  public calculatePath(startNodeId: string, endNodeId: string): L.LatLng[] | null {
    try {
      const nodePath: string[] = find_path(this.campusGraphData, startNodeId, endNodeId);
      return nodePath.map((pid) => this.nodeCoords[pid]).filter(Boolean);
    } catch (e) {
      console.warn(`NO PATH: ${startNodeId} → ${endNodeId}`, e);
      return null;
    }
  }

  public calculatePathWithLength(startNodeId: string, endNodeId: string) {
    const points = this.calculatePath(startNodeId, endNodeId);
    if (!points || points.length < 2) return null;

    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += points[i - 1].distanceTo(points[i]);
    }

    return { points, lengthM: Math.round(len) };
  }

  public findBestStartNodeForDestination(lat: number, lng: number, endNodeId: string): string | null {
    const here = L.latLng(lat, lng);

    const lengthCache = new Map<string, number>();
    const getPathLengthFrom = (from: string): number | null => {
      if (lengthCache.has(from)) {
        const val = lengthCache.get(from)!;
        return val === Infinity ? null : val;
      }

      const res = this.calculatePathWithLength(from, endNodeId);
      if (!res) {
        lengthCache.set(from, Infinity);
        return null;
      }

      lengthCache.set(from, res.lengthM);
      return res.lengthM;
    };

    const MAX_START_RADIUS = 120;
    let bestNode: string | null = null;
    let bestCost = Infinity;

    for (const [id, ll] of Object.entries(this.nodeCoords)) {
      const dUserToNode = here.distanceTo(ll);
      if (dUserToNode > MAX_START_RADIUS) continue;

      const pathLen = getPathLengthFrom(id);
      if (pathLen == null) continue;

      const totalCost = dUserToNode + pathLen;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestNode = id;
      }
    }

    return bestNode;
  }

  // -------- DEBUG helpers --------
  public calculatePathNodeIds(startNodeId: string, endNodeId: string): string[] | null {
    try {
      const nodePath: string[] = find_path(this.campusGraphData, startNodeId, endNodeId);
      return nodePath;
    } catch (e) {
      console.warn(`NO PATH (ids): ${startNodeId} → ${endNodeId}`, e);
      return null;
    }
  }

  public getNodeLatLng(id: string): L.LatLng | undefined {
    return this.nodeCoords[id];
  }
}
