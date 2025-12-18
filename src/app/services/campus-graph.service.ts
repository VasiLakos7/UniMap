import { Injectable } from '@angular/core';
import { find_path } from 'dijkstrajs';
import * as L from 'leaflet';
// import { Destination } from '../models/destination.model';

// ----------------------------------------------------
// 1) NODE COORDS — Κόμβοι διαδρομής γύρω από το campus
// ----------------------------------------------------
const nodeCoords = {
  // 🔹 ΑΡΙΣΤΕΡΗ ΜΠΡΟΣΤΙΝΗ ΠΛΕΥΡΑ (από πάνω προς κάτω)
  L_EDGE_1: L.latLng(40.65804134873658, 22.802114061872675),
  L_EDGE_2: L.latLng(40.65761534861251, 22.80210928271519),
  L_EDGE_3: L.latLng(40.65738512613233, 22.802123620173496),
  L_EDGE_4: L.latLng(40.657038884541016, 22.802097334831537),
  L_EDGE_5: L.latLng(40.65614764156474, 22.80210862617149),
  L_EDGE_6: L.latLng(40.65575063452395, 22.802106236596035),

  // 🔹 ΚΑΤΩ ΠΛΕΥΡΑ – από κάτω αριστερά προς τα δεξιά
  BOT_1: L.latLng(40.65574338323259, 22.80255786656949),

  MPD_JUNC: L.latLng(40.65575676754222, 22.803262729547537),
  BOT_2: L.latLng(40.65576151146118, 22.803582994906154),

  // Νέα σημεία ευθεία από BOT_2 προς ΣΔΟ / κεντρικό διάδρομο
  B2_UP_1: L.latLng(40.65624421706049, 22.80356267336902),
  LOG_FRONT: L.latLng(40.65645125552037, 22.803571695208625),
  MID_HC_1: L.latLng(40.65665144913412, 22.803562673376618),

  // Διακλάδωση από MID_HC_1 προς τα "μέσα" (κάθετο κλαδί)
  MID_HC_DOWN: L.latLng(40.65665144913412, 22.803122858695925),

  // Πρώτο δεξί σημείο – αρχή κλαδιού προς βιβλιοθ/φυσικοθερ.
  MID_HC_RIGHT_1: L.latLng(40.65708947748495, 22.80347471044048),

  LIB_SEG_1: L.latLng(40.657105776483185, 22.803528343928487),
  LIB_JUNC_MAIN: L.latLng(40.657108828658465, 22.80363697339144),
  LIB_JUNC_3WAY: L.latLng(40.657215654705446, 22.803647702227128),
  LIB_FRONT: L.latLng(40.65720355937115, 22.803524571319407),

  PHYSIO_JUNC: L.latLng(40.65719366268964, 22.804095134427097),
  PHYSIO_TO_R3_MID: L.latLng(40.65717410232367, 22.804389685173),

  LIB_UP: L.latLng(40.65743363877041, 22.803668172548967),

  // ➕ ΣΥΝΕΧΕΙΑ ΠΡΟΣ ΔΙΑΤΡΟΦΗ & ΔΙΑΙΤΟΛΟΓΙΑ
  LIB_UP_2: L.latLng(40.65764453195437, 22.80362157836841),
  LIB_UP_JUNC_DD: L.latLng(40.657830136595905, 22.803617785152298),
  DIET_DIET_ENT: L.latLng(40.658006430808285, 22.803597743580113),
  LIB_UP_LEFT_1: L.latLng(40.657853946562334, 22.803254261006277),
  TOP_JOIN_DD: L.latLng(40.65866455855133, 22.803267019810647),

  MID_HC_RIGHT_2: L.latLng(40.65710170691591, 22.80314210583795),

  // 🔹 ΔΙΧΑΛΑ ΣΤΗΝ ΚΑΤΩ ΠΛΕΥΡΑ
  BOT_3: L.latLng(40.65574157040703, 22.804476696553447),
  BOT_4: L.latLng(40.65571619087804, 22.80467981055955),
  BOT_5: L.latLng(40.65569624981274, 22.80530587961364),

  BR_INF_P_1: L.latLng(40.65575788581344, 22.804051351928912),

  // Καμπύλη
  ARC_1: L.latLng(40.65577238839656, 22.80468936888138),
  ARC_2: L.latLng(40.65586846791024, 22.805002403408427),
  ARC_3: L.latLng(40.656017118960676, 22.80518640080219),
  ARC_4: L.latLng(40.65611682374794, 22.805262867251543),

  H_AFTER_1: L.latLng(40.65613857749992, 22.805334554547812),
  MERGE_DYCH: L.latLng(40.65624734615334, 22.805327385818188),

  // 🔹 ΔΕΞΙΑ ΠΛΕΥΡΑ – ραχοκοκαλιά
  R_EDGE_1: L.latLng(40.65666066542897, 22.80532977539946),
  R_EDGE_2: L.latLng(40.657084858863996, 22.805336944130598),
  R_EDGE_3: L.latLng(40.65716280864757, 22.80532977540097),

  // Νέος κόμβος έξω από Νοσηλευτική (κάθετος δρόμος)
  NURSING_OUTER: L.latLng(40.65716933419156, 22.804947877121148),

  // 🔹 ΚΛΑΔΙ Μαιευτικής από τη διασταύρωση
  R_MAIEUTIKI_FRONT: L.latLng(40.65709100256497, 22.80591089248597),

  // Κόμβος μπροστά από Νοσηλευτική (πάνω στον δρόμο)
  R_NURSING_JUNC: L.latLng(40.65744741521869, 22.805341723285114),

  R_EDGE_4: L.latLng(40.65809094788959, 22.805351281592937),
  R_EDGE_5: L.latLng(40.65866377738532, 22.805348892016344),

  // 🔹 ΠΑΝΩ ΠΛΕΥΡΑ – από δεξιά προς αριστερά
  TOP_1: L.latLng(40.65867646659213, 22.804691758452172),
  TOP_2: L.latLng(40.65866921561809, 22.803977275066007),
  TOP_3: L.latLng(40.65868190482195, 22.803269960403846),
  TOP_4: L.latLng(40.65868009207302, 22.802242442468554),

  TOP_BRANCH_1: L.latLng(40.658101824451464, 22.802256779927806),

  // 🔹 ΕΣΩΤΕΡΙΚΗ ΚΑΘΕΤΗ
  MID_1: L.latLng(40.65808834042946, 22.802559503549656),
  MID_2: L.latLng(40.65762537872428, 22.80256194907016),
  MID_3: L.latLng(40.657401164207016, 22.802560888881565),
  MID_4: L.latLng(40.657114721823525, 22.802561765805827),
  MID_5: L.latLng(40.657054695611656, 22.80255640138097),
  MID_6: L.latLng(40.65699424909833, 22.802557776440118),

  MID_6_PRE: L.latLng(40.656649300925224, 22.802552435332586),
  MID_7: L.latLng(40.656544034692004, 22.80254722800602),
  MID_8: L.latLng(40.656145882762026, 22.802546816106975),

  // 🔹 ΕΙΣΟΔΟΙ ΤΜΗΜΑΤΩΝ (κόμβοι που πάνε μέχρι την πόρτα)
  MAIEUTIKI_ENT: L.latLng(40.657129383535285, 22.805900015164596),
  NURSING_ENT: L.latLng(40.657403177714485, 22.804956696585524),
  PHYSIO_ENT: L.latLng(40.65741108499712, 22.80423227005972),
} as const;

export type NodeId = keyof typeof nodeCoords;

// ----------------------------------------------------
// 2) UNDIRECTED EDGES — Συνδέσεις κόμβων
// ----------------------------------------------------
const UNDIRECTED_EDGES: Array<[NodeId, NodeId]> = [
  // ΑΡΙΣΤΕΡΗ ΠΡΟΣΟΨΗ
  ['L_EDGE_1', 'L_EDGE_2'],
  ['L_EDGE_2', 'L_EDGE_3'],
  ['L_EDGE_3', 'L_EDGE_4'],
  ['L_EDGE_4', 'L_EDGE_5'],
  ['L_EDGE_5', 'L_EDGE_6'],

  ['L_EDGE_6', 'BOT_1'],

  // ΚΑΤΩ ΠΛΕΥΡΑ
  ['BOT_1', 'MPD_JUNC'],
  ['MPD_JUNC', 'BOT_2'],

  // BOT_2 → ΣΔΟ / κεντρικός διάδρομος
  ['BOT_2', 'B2_UP_1'],
  ['B2_UP_1', 'LOG_FRONT'],
  ['LOG_FRONT', 'MID_HC_1'],

  // BOT_3 συνδέεται με BOT_2 στον κάτω δρόμο
  ['BOT_3', 'BOT_2'],

  // Κλαδί προς κτήριο Π
  ['BOT_2', 'BR_INF_P_1'],

  // Κλαδί MID_HC_1 → βιβλιοθήκη / φυσικοθεραπεία / πάνω
  ['MID_HC_1', 'MID_HC_RIGHT_1'],
  ['MID_HC_RIGHT_1', 'LIB_SEG_1'],
  ['LIB_SEG_1', 'LIB_JUNC_MAIN'],
  ['LIB_JUNC_MAIN', 'LIB_JUNC_3WAY'],

  ['LIB_JUNC_3WAY', 'LIB_FRONT'],
  ['LIB_JUNC_3WAY', 'PHYSIO_JUNC'],
  ['LIB_JUNC_3WAY', 'LIB_UP'],

  // Φυσικοθεραπεία: κλαδί μέχρι είσοδο + σύνδεση προς δεξιά ραχοκοκαλιά
  ['PHYSIO_JUNC', 'PHYSIO_ENT'],
  ['PHYSIO_JUNC', 'PHYSIO_TO_R3_MID'],
  ['PHYSIO_TO_R3_MID', 'NURSING_OUTER'],
  ['NURSING_OUTER', 'R_EDGE_3'],

  // Συνέχεια προς Διατροφή & Διαιτολογία
  ['LIB_UP', 'LIB_UP_2'],
  ['LIB_UP_2', 'LIB_UP_JUNC_DD'],
  ['LIB_UP_JUNC_DD', 'DIET_DIET_ENT'],
  ['LIB_UP_JUNC_DD', 'LIB_UP_LEFT_1'],
  ['LIB_UP_LEFT_1', 'TOP_JOIN_DD'],
  ['TOP_JOIN_DD', 'TOP_3'],

  ['MID_HC_RIGHT_1', 'MID_HC_RIGHT_2'],
  ['MID_HC_RIGHT_2', 'MID_HC_DOWN'],

  // ΔΙΧΑΛΑ ΚΑΤΩ
  ['BOT_3', 'BOT_4'],
  ['BOT_3', 'BOT_5'],

  // Καμπύλη προς MERGE_DYCH
  ['BOT_4', 'ARC_1'],
  ['ARC_1', 'ARC_2'],
  ['ARC_2', 'ARC_3'],
  ['ARC_3', 'ARC_4'],

  ['BOT_5', 'H_AFTER_1'],
  ['H_AFTER_1', 'MERGE_DYCH'],
  ['ARC_4', 'MERGE_DYCH'],

  // ΔΕΞΙΑ ΡΑΧΟΚΟΚΑΛΙΑ
  ['MERGE_DYCH', 'R_EDGE_1'],
  ['R_EDGE_1', 'R_EDGE_2'],
  ['R_EDGE_2', 'R_EDGE_3'],
  ['R_EDGE_3', 'R_NURSING_JUNC'],
  ['R_NURSING_JUNC', 'R_EDGE_4'],
  ['R_EDGE_4', 'R_EDGE_5'],

  // Κλαδί προς Μαιευτική
  ['R_EDGE_2', 'R_MAIEUTIKI_FRONT'],
  ['R_MAIEUTIKI_FRONT', 'MAIEUTIKI_ENT'],

  // Κλαδί προς είσοδο Νοσηλευτικής
  ['NURSING_OUTER', 'NURSING_ENT'],

  ['R_EDGE_5', 'TOP_1'],

  // ΠΑΝΩ ΠΛΕΥΡΑ
  ['TOP_1', 'TOP_2'],
  ['TOP_2', 'TOP_3'],
  ['TOP_3', 'TOP_4'],

  // Κλαδί προς τα αριστερά
  ['TOP_4', 'TOP_BRANCH_1'],
  ['TOP_BRANCH_1', 'L_EDGE_1'],

  // ΕΣΩΤΕΡΙΚΗ ΚΑΘΕΤΗ
  ['TOP_BRANCH_1', 'MID_1'],
  ['MID_1', 'MID_2'],
  ['MID_2', 'MID_3'],
  ['MID_3', 'MID_4'],
  ['MID_4', 'MID_5'],
  ['MID_5', 'MID_6'],

  ['MID_6', 'MID_6_PRE'],
  ['MID_6_PRE', 'MID_7'],
  ['MID_7', 'MID_8'],
  ['MID_8', 'BOT_1'],

  // ΣΥΝΔΕΣΕΙΣ ΕΣΩΤΕΡΙΚΗΣ ΜΕ ΠΡΟΣΟΨΗ
  ['MID_2', 'L_EDGE_2'],
  ['MID_3', 'L_EDGE_3'],
  ['MID_5', 'L_EDGE_4'],
  ['MID_8', 'L_EDGE_5'],
];

// ----------------------------------------------------
// 3) Graph weights
// ----------------------------------------------------
function distMeters(a: L.LatLng, b: L.LatLng): number {
  return a.distanceTo(b);
}

function buildAdjacency(edges: Array<[NodeId, NodeId]>) {
  const g: Record<string, Record<string, number>> = {};

  const add = (u: NodeId, v: NodeId) => {
    const w = Math.max(1, Math.round(distMeters(nodeCoords[u], nodeCoords[v])));
    if (!g[u]) g[u] = {};
    g[u][v] = w;
  };

  for (const [u, v] of edges) {
    add(u, v);
    add(v, u);
  }

  return g;
}

const campusGraphData = buildAdjacency(UNDIRECTED_EDGES);

// ----------------------------------------------------
// 4) Normalizer & alias
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

// mapping από όνομα τμήματος → nodeId (είσοδοι κλπ)
const alias = new Map<string, NodeId>([
  ['ΜΑΙΕΥΤΙΚΗΣ', 'MAIEUTIKI_ENT'],
  ['ΝΟΣΗΛΕΥΤΙΚΗΣ', 'NURSING_ENT'],
  ['ΦΥΣΙΚΟΘΕΡΑΠΕΙΑΣ', 'PHYSIO_ENT'],
  ['ΔΙΑΤΡΟΦΗΣ ΚΑΙ ΔΙΑΙΤΟΛΟΓΙΑΣ', 'DIET_DIET_ENT'],
  ['ΓΕΩΠΟΝΙΑΣ', 'TOP_JOIN_DD'],
  ['ΕΠΙΣΤΗΜΗΣ ΚΑΙ ΤΕΧΝΟΛΟΓΙΑΣ ΤΡΟΦΙΜΩΝ', 'MID_8'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΑΡΑΓΩΓΗΣ ΚΑΙ ΔΙΟΙΚΗΣΗΣ (ΠΑΡΑΡΤΗΜΑ ΟΧΗΜΑΤΩΝ)', 'MPD_JUNC'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΛΗΡΟΦΟΡΙΚΗΣ (ΚΤΗΡΙΟ Η)', 'H_AFTER_1'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΛΗΡΟΦΟΡΙΚΗΣ (ΚΤΗΡΙΟ Π)', 'BR_INF_P_1'],
  ['ΔΙΟΙΚΗΣΗΣ ΟΡΓΑΝΙΣΜΩΝ, ΜΑΡΚΕΤΙΝΓΚ ΚΑΙ ΤΟΥΡΙΣΜΟΥ', 'MID_HC_RIGHT_2'],
  ['ΒΙΒΛΙΟΘΗΚΟΝΟΜΙΑΣ, ΑΡΧΕΙΟΝΟΜΙΑΣ & ΣΥΣΤΗΜΑΤΩΝ ΠΛΗΡΟΦΟΡΗΣΗΣ', 'LIB_FRONT'],
  ['ΜΗΧΑΝΙΚΩΝ ΠΕΡΙΒΑΛΛΟΝΤΟΣ', 'MID_7'],
  ['ΛΟΓΙΣΤΙΚΗΣ ΚΑΙ ΠΛΗΡΟΦΟΡΙΑΚΩΝ ΣΥΣΤΗΜΑΤΩΝ', 'LOG_FRONT'],
]);

// ----------------------------------------------------
// 5) SERVICE
// ----------------------------------------------------
@Injectable({ providedIn: 'root' })
export class CampusGraphService {
  public getNodeIdForName(destinationName: string): NodeId | null {
    const key = norm(destinationName);
    return alias.get(key) ?? null;
  }

  public getDestinationCoords(nameOrId: string): L.LatLng | undefined {
    if ((nodeCoords as any)[nameOrId]) {
      return nodeCoords[nameOrId as NodeId];
    }
    const id = this.getNodeIdForName(nameOrId);
    return id ? nodeCoords[id] : undefined;
  }

  public findNearestNodeId(lat: number, lng: number): NodeId | null {
    const here = L.latLng(lat, lng);

    let best: NodeId | null = null;
    let bestDist = Infinity;

    (Object.keys(nodeCoords) as NodeId[]).forEach((id) => {
      const d = here.distanceTo(nodeCoords[id]);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    });

    return best;
  }

  public calculatePath(startNodeId: string, endNodeId: string): L.LatLng[] | null {
    try {
      const nodePath: string[] = find_path(campusGraphData, startNodeId, endNodeId);
      return nodePath.map((pid) => nodeCoords[pid as NodeId]);
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

  public findBestStartNodeForDestination(
    lat: number,
    lng: number,
    endNodeId: string
  ): string | null {
    const here = L.latLng(lat, lng);
    const destId = endNodeId as NodeId;

    const lengthCache = new Map<NodeId, number>();

    const getPathLengthFrom = (from: NodeId): number | null => {
      if (lengthCache.has(from)) {
        const val = lengthCache.get(from)!;
        return val === Infinity ? null : val;
      }

      const res = this.calculatePathWithLength(from, destId);
      if (!res) {
        lengthCache.set(from, Infinity);
        return null;
      }

      lengthCache.set(from, res.lengthM);
      return res.lengthM;
    };

    const MAX_START_RADIUS = 120; // μέτρα γύρω από τον χρήστη

    let bestNode: NodeId | null = null;
    let bestCost = Infinity;

    (Object.keys(nodeCoords) as NodeId[]).forEach((id) => {
      const nodeCoord = nodeCoords[id];

      const dUserToNode = here.distanceTo(nodeCoord);
      if (dUserToNode > MAX_START_RADIUS) {
        return;
      }

      const pathLen = getPathLengthFrom(id);
      if (pathLen == null) return;

      const totalCost = dUserToNode + pathLen;

      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestNode = id;
      }
    });

    return bestNode;
  }
}
