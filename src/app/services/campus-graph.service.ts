import { Injectable } from '@angular/core';
import { find_path } from 'dijkstrajs';
import * as L from 'leaflet';

// ----------------------------------------------------
// 1) NODE COORDS — Κόμβοι διαδρομής
// ----------------------------------------------------
const nodeCoords = {
  // BUS STOP ROUTE → ΜΑΪΕΥΤΙΚΗ
  BS_1:            L.latLng(40.657347, 22.801856),   // Στάση λεωφορείου
  BS_2:            L.latLng(40.657376, 22.802575),   // Είσοδος μονοπατιού
  PATH_1:          L.latLng(40.657091, 22.802580),   // Έξοδος μονοπατιού
  FOUNTAIN_1:      L.latLng(40.657095, 22.803197),   // Συντριβάνι γωνία 1
  FOUNTAIN_2:      L.latLng(40.657083, 22.803540),   // Συντριβάνι γωνία 2
  ALIGN_1:         L.latLng(40.657197, 22.803546),   // Ευθυγράμμιση
  MAIN_BEFORE_MAI: L.latLng(40.657160, 22.805396),   // Πριν τον δρόμο
  MAI_ROAD:        L.latLng(40.657453, 22.805369),   // Δρόμος έξω από Μαιευτική
  MAI_ENTRANCE:    L.latLng(40.657445, 22.805300),   // Είσοδος Μαιευτικής

  // ΝΟΣΗΛΕΥΤΙΚΗ (μόνο ένας κόμβος προς το παρόν)
  NOSILEUTIKI:     L.latLng(40.657477353074515, 22.804638050453958),
} as const;

type NodeId = keyof typeof nodeCoords;

// ----------------------------------------------------
// 2) UNDIRECTED EDGES — Ποιοι κόμβοι ενώνονται
// ----------------------------------------------------
const UNDIRECTED_EDGES: Array<[NodeId, NodeId]> = [
  // Πλήρης διαδρομή προς Μαιευτική
  ['BS_1', 'BS_2'],
  ['BS_2', 'PATH_1'],
  ['PATH_1', 'FOUNTAIN_1'],
  ['FOUNTAIN_1', 'FOUNTAIN_2'],
  ['FOUNTAIN_2', 'ALIGN_1'],
  ['ALIGN_1', 'MAIN_BEFORE_MAI'],
  ['MAIN_BEFORE_MAI', 'MAI_ROAD'],
  ['MAI_ROAD', 'MAI_ENTRANCE'],

  // Σύνδεση Νοσηλευτικής (προσωρινή)
  ['ALIGN_1', 'NOSILEUTIKI'],
  ['MAIN_BEFORE_MAI', 'NOSILEUTIKI'],
];

// ----------------------------------------------------
// 3) Build graph with weighted edges
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
// 4) Normalizer & Alias Table
// ----------------------------------------------------
function norm(s: string): string {
  return s.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ΤΜΗΜΑ /g, "")
    .replace(/ΣΧΟΛΗ /g, "")
    .trim();
}

const alias = new Map<string, NodeId>([
  // Μαιευτική
  ['ΜΑΙΕΥΤΙΚΗ', 'MAI_ENTRANCE'],
  ['ΜΑΙΕΥΤΙΚΗΣ', 'MAI_ENTRANCE'],
  ['ΤΜΗΜΑ ΜΑΙΕΥΤΙΚΗΣ', 'MAI_ENTRANCE'],
  ['MAI', 'MAI_ENTRANCE'],

  // Νοσηλευτική
  ['ΝΟΣΗΛΕΥΤΙΚΗ', 'NOSILEUTIKI'],
  ['ΝΟΣΗΛΕΥΤΙΚΗΣ', 'NOSILEUTIKI'],
  ['ΤΜΗΜΑ ΝΟΣΗΛΕΥΤΙΚΗΣ', 'NOSILEUTIKI'],
]);

// ----------------------------------------------------
// 5) SERVICE
// ----------------------------------------------------
@Injectable({ providedIn: 'root' })
export class CampusGraphService {

  /** Παίρνει nodeId από όνομα τμήματος */
  public getNodeIdForName(destinationName: string): NodeId | null {
    const key = norm(destinationName);
    return alias.get(key) ?? null;
  }

  /** Συντεταγμένες κόμβου */
  public getDestinationCoords(nameOrId: string): L.LatLng | undefined {
    if ((nodeCoords as any)[nameOrId]) {
      return nodeCoords[nameOrId as NodeId];
    }
    const id = this.getNodeIdForName(nameOrId);
    return id ? nodeCoords[id] : undefined;
  }

  /** Πλησιέστερος κόμβος στον χρήστη */
  public findNearestNodeId(lat: number, lng: number): NodeId | null {
    const here = L.latLng(lat, lng);

    let best: NodeId | null = null;
    let bestDist = Infinity;

    (Object.keys(nodeCoords) as NodeId[]).forEach(id => {
      const d = here.distanceTo(nodeCoords[id]);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    });

    return best;
  }

  /** Υπολογισμός διαδρομής Dijkstra */
  public calculatePath(startNodeId: string, endNodeId: string): L.LatLng[] | null {
    try {
      const nodePath: string[] = find_path(campusGraphData, startNodeId, endNodeId);
      return nodePath.map(pid => nodeCoords[pid as NodeId]);
    } catch (e) {
      console.warn(`NO PATH: ${startNodeId} → ${endNodeId}`, e);
      return null;
    }
  }

  /** Προαιρετικό: Επιστροφή μήκους */
  public calculatePathWithLength(startNodeId: string, endNodeId: string) {
    const points = this.calculatePath(startNodeId, endNodeId);
    if (!points || points.length < 2) return null;

    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += points[i - 1].distanceTo(points[i]);
    }

    return { points, lengthM: Math.round(len) };
  }
}
