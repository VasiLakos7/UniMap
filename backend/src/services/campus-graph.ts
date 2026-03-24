import { find_path } from 'dijkstrajs';
import { Adjacency, LatLng, RouteResult } from '../types';
import { OSM_NODE_COORDS, OSM_EDGES } from '../data/osm-nodes';
import { MANUAL_NODE_COORDS, MANUAL_EDGES } from '../data/manual-nodes';
import { POI_NODE_COORDS, POI_ALIAS } from '../data/poi-nodes';
import { distanceTo } from './geo';
import { getEdgeTag, edgeAllowedForWheelchair, registerAccessibilityEdges } from './accessibility';

// Normalizer ονομάτων
function norm(s: string): string {
  return s
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'ΚΑΙ')
    .replace(/ΤΜΗΜΑ /g, '')
    .replace(/ΣΧΟΛΗ /g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Graph building utilities
function computeBBox(points: LatLng[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

function inBBox(
  p: LatLng,
  bb: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): boolean {
  return p.lat >= bb.minLat && p.lat <= bb.maxLat && p.lng >= bb.minLng && p.lng <= bb.maxLng;
}

function addUndirectedEdge(
  g: Adjacency,
  coords: Record<string, LatLng>,
  u: string,
  v: string
): void {
  const a = coords[u];
  const b = coords[v];
  if (!a || !b) return;

  const w = Math.max(1, Math.round(distanceTo(a, b)));
  if (!g[u]) g[u] = {};
  if (!g[v]) g[v] = {};
  g[u][v] = Math.min(g[u][v] ?? Infinity, w);
  g[v][u] = Math.min(g[v][u] ?? Infinity, w);
}

function removeUndirectedEdge(g: Adjacency, u: string, v: string): void {
  if (g[u]) delete g[u][v];
  if (g[v]) delete g[v][u];
}

function buildAdjacencyFromEdges(
  edges: Array<[string, string]>,
  coords: Record<string, LatLng>
): Adjacency {
  const g: Adjacency = {};
  for (const [u, v] of edges) addUndirectedEdge(g, coords, u, v);
  return g;
}

function splitEdgeWithChain(
  g: Adjacency,
  coords: Record<string, LatLng>,
  a: string,
  b: string,
  chain: string[]
): void {
  removeUndirectedEdge(g, a, b);
  let prev = a;
  for (const mid of chain) {
    addUndirectedEdge(g, coords, prev, mid);
    prev = mid;
  }
  addUndirectedEdge(g, coords, prev, b);
}

function healCloseNodes(
  ids: string[],
  coords: Record<string, LatLng>,
  g: Adjacency,
  maxDistM: number
): void {
  for (let i = 0; i < ids.length; i++) {
    const aId = ids[i];
    const a = coords[aId];
    if (!a) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const bId = ids[j];
      const b = coords[bId];
      if (!b) continue;
      if (distanceTo(a, b) <= maxDistM) addUndirectedEdge(g, coords, aId, bId);
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
      for (const v of Object.keys(g[u] ?? {})) {
        if (!seen.has(v)) { seen.add(v); stack.push(v); }
      }
    }
    if (comp.size > best.size) best = comp;
  }
  return best;
}

function findNearestInSet(
  lat: number,
  lng: number,
  ids: string[],
  coords: Record<string, LatLng>
): { id: string | null; distM: number } {
  const here: LatLng = { lat, lng };
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const id of ids) {
    const c = coords[id];
    if (!c) continue;
    const d = distanceTo(here, c);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return { id: bestId, distM: bestDist };
}

// Build merged graph (εκτελείται μία φορά κατά την εκκίνηση)
type MergedGraph = {
  coords: Record<string, LatLng>;
  adjacency: Adjacency;
  snapCandidates: string[];
};

function buildMergedGraph(): MergedGraph {
  const seedPoints = [
    ...Object.values(POI_NODE_COORDS),
    ...Object.values(MANUAL_NODE_COORDS),
  ];
  const bb0 = computeBBox(seedPoints);
  const MARGIN = 0.0022;
  const bb = {
    minLat: bb0.minLat - MARGIN,
    maxLat: bb0.maxLat + MARGIN,
    minLng: bb0.minLng - MARGIN,
    maxLng: bb0.maxLng + MARGIN,
  };

  const keptOSM: Record<string, LatLng> = {};
  for (const [id, ll] of Object.entries(OSM_NODE_COORDS)) {
    if (inBBox(ll, bb)) keptOSM[id] = ll;
  }
  const keptOSMIds = Object.keys(keptOSM);

  const keptEdges: Array<[string, string]> = OSM_EDGES.filter(
    ([u, v]) => keptOSM[u] && keptOSM[v]
  );

  const manualIds = Object.keys(MANUAL_NODE_COORDS);
  const ALL: Record<string, LatLng> = {
    ...keptOSM,
    ...MANUAL_NODE_COORDS,
    ...POI_NODE_COORDS,
  };

  const g = buildAdjacencyFromEdges(keptEdges, ALL);

  for (const [u, v] of MANUAL_EDGES) addUndirectedEdge(g, ALL, u, v);

  splitEdgeWithChain(g, ALL, 'N0068', 'N0060', ['M_68_TO_BOTTOM_1', 'M_BOTTOM_MID', 'M_BOTTOM_TO_60_1']);
  splitEdgeWithChain(g, ALL, 'N0060', 'N0069', ['M_60_TO_69_1']);
  splitEdgeWithChain(g, ALL, 'N0108', 'N0052', ['M_0108_TO_0052_1']);
  splitEdgeWithChain(g, ALL, 'N0058', 'N0059', ['M_58_TO_59_1']);
  splitEdgeWithChain(g, ALL, 'N0036', 'N0067', ['M_36_TO_67_PRE_1', 'M_36_TO_67_1']);

  const baseIds = [...keptOSMIds, ...manualIds];
  healCloseNodes(baseIds, ALL, g, 6);

  const largest = getLargestComponent(baseIds, g);
  const snapCandidates = baseIds.filter((id) => largest.has(id));

  for (const [poiId, poiLL] of Object.entries(POI_NODE_COORDS)) {
    const { id: nearId, distM } = findNearestInSet(poiLL.lat, poiLL.lng, snapCandidates, ALL);
    if (!nearId) { console.warn(`[CampusGraph] POI ${poiId} δεν βρήκε κοντινό node.`); continue; }
    if (distM > 60) console.warn(`[CampusGraph] POI ${poiId} είναι ${Math.round(distM)}m από το ${nearId}.`);
    addUndirectedEdge(g, ALL, poiId, nearId);
  }

  // POI entrance nodes συμμετέχουν ως snap candidates: αν ο χρήστης
  // είναι πλησιέστερα σε είσοδο κτιρίου από οποιονδήποτε άλλο node,
  // η διαδρομή ξεκινά από εκεί (φυσική συμπεριφορά, χωρίς magic radius).
  const poiIds = Object.keys(POI_NODE_COORDS);
  const allSnapCandidates = [...snapCandidates, ...poiIds];

  return { coords: ALL, adjacency: g, snapCandidates: allSnapCandidates };
}

// Singleton — φτιάχνεται μία φορά
registerAccessibilityEdges();
const MERGED = buildMergedGraph();

// Wheelchair-filtered graph (lazy)
let wheelchairAdj: Adjacency | undefined;
let wheelchairSnap: string[] | undefined;

function getAdjacency(wheelchair: boolean): Adjacency {
  if (!wheelchair) return MERGED.adjacency;
  if (wheelchairAdj) return wheelchairAdj;

  const filtered: Adjacency = {};
  for (const [u, nbrs] of Object.entries(MERGED.adjacency)) {
    for (const [v, w] of Object.entries(nbrs)) {
      if (!edgeAllowedForWheelchair(getEdgeTag(u, v))) continue;
      (filtered[u] ??= {})[v] = w;
    }
  }
  wheelchairAdj = filtered;
  return filtered;
}

function getSnapCandidates(wheelchair: boolean): string[] {
  if (!wheelchair) return MERGED.snapCandidates;
  if (wheelchairSnap) return wheelchairSnap;
  const g = getAdjacency(true);
  wheelchairSnap = MERGED.snapCandidates.filter((id) => g[id] && Object.keys(g[id]).length > 0);
  return wheelchairSnap;
}

// Project point P onto segment AB, return closest point on segment + parameter t ∈ [0,1]
function projectPointOnSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng
): { point: LatLng; t: number; distM: number } {
  const latToM = (Math.PI / 180) * 6371000;
  const lngToM = latToM * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);

  const px = (p.lng - a.lng) * lngToM;
  const py = (p.lat - a.lat) * latToM;
  const bx = (b.lng - a.lng) * lngToM;
  const by = (b.lat - a.lat) * latToM;
  const len2 = bx * bx + by * by;

  if (len2 < 1e-10) return { point: a, t: 0, distM: distanceTo(p, a) };

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const point: LatLng = {
    lat: a.lat + t * (b.lat - a.lat),
    lng: a.lng + t * (b.lng - a.lng),
  };
  return { point, t, distM: distanceTo(p, point) };
}

// Public API
const MAX_SNAP_METERS = 90;
const MAX_START_RADIUS = 120;


export function getNodeIdForName(destinationName: string): string | null {
  return POI_ALIAS.get(norm(destinationName)) ?? null;
}

export function getNodeCoords(nodeId: string): LatLng | undefined {
  return MERGED.coords[nodeId];
}

export function findNearestNodeId(
  lat: number,
  lng: number,
  opts?: { wheelchair?: boolean }
): string | null {
  const here: LatLng = { lat, lng };
  const candidates = getSnapCandidates(!!opts?.wheelchair);
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const id of candidates) {
    const ll = MERGED.coords[id];
    if (!ll) continue;
    const d = distanceTo(here, ll);
    if (d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestDist <= MAX_SNAP_METERS ? bestId : null;
}

export function calculatePath(
  startNodeId: string,
  endNodeId: string,
  opts?: { wheelchair?: boolean }
): LatLng[] | null {
  try {
    const g = getAdjacency(!!opts?.wheelchair);
    const nodePath: string[] = find_path(g, startNodeId, endNodeId);
    return nodePath.map((id) => MERGED.coords[id]).filter(Boolean);
  } catch {
    return null;
  }
}

export function calculatePathWithLength(
  startNodeId: string,
  endNodeId: string,
  opts?: { wheelchair?: boolean }
): RouteResult | null {
  const points = calculatePath(startNodeId, endNodeId, opts);
  if (!points || points.length < 2) return null;

  let len = 0;
  for (let i = 1; i < points.length; i++) len += distanceTo(points[i - 1], points[i]);

  return { path: points, lengthM: Math.round(len) };
}

const VIRTUAL_START = '__USER__';
const VIRTUAL_PROJ  = '__PROJ__';

/**
 * Calculates a route from the user's exact GPS position to endNodeId.
 *
 * Instead of connecting the virtual start to the K nearest nodes (which can
 * produce a first segment that cuts through buildings), we project the user's
 * position onto the nearest graph edge.  The route then goes:
 *   user → projection_point (perpendicular to nearest path) → graph nodes → destination
 * This keeps the first segment short and on-path, avoiding buildings/obstacles.
 */
export function calculateRouteFromPosition(
  lat: number,
  lng: number,
  endNodeId: string,
  opts?: { wheelchair?: boolean }
): RouteResult | null {
  const here: LatLng = { lat, lng };
  const baseAdj = getAdjacency(!!opts?.wheelchair);

  // Find the nearest graph edge by perpendicular distance from the user
  const seen = new Set<string>();
  let best: { u: string; v: string; proj: LatLng; t: number; distM: number; w: number } | null = null;

  for (const u of Object.keys(baseAdj)) {
    const a = MERGED.coords[u];
    if (!a) continue;
    for (const [v, w] of Object.entries(baseAdj[u])) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = MERGED.coords[v];
      if (!b) continue;
      const { point, t, distM } = projectPointOnSegment(here, a, b);
      if (distM <= MAX_START_RADIUS && (!best || distM < best.distM)) {
        best = { u, v, proj: point, t, distM, w };
      }
    }
  }

  if (!best) return null;

  const { u, v, proj, t, distM, w } = best;
  const virtCoords: Record<string, LatLng> = { [VIRTUAL_START]: here };

  // Build a shallow-copy adjacency and inject virtual nodes
  const adj: Adjacency = { ...baseAdj, [VIRTUAL_START]: {} };

  if (t < 0.02) {
    // User projects almost onto node u — connect directly
    adj[VIRTUAL_START][u] = Math.round(distM) || 1;
  } else if (t > 0.98) {
    // User projects almost onto node v — connect directly
    adj[VIRTUAL_START][v] = Math.round(distM) || 1;
  } else {
    // Split the edge at the projection point and route through it
    virtCoords[VIRTUAL_PROJ] = proj;
    adj[VIRTUAL_START][VIRTUAL_PROJ] = Math.round(distM) || 1;
    adj[VIRTUAL_PROJ] = {
      [u]: Math.round(t * w) || 1,
      [v]: Math.round((1 - t) * w) || 1,
    };
    // Add back-edges so dijkstra can reach VIRTUAL_PROJ from either side
    adj[u] = { ...adj[u], [VIRTUAL_PROJ]: Math.round(t * w) || 1 };
    adj[v] = { ...adj[v], [VIRTUAL_PROJ]: Math.round((1 - t) * w) || 1 };
  }

  try {
    const nodePath: string[] = find_path(adj, VIRTUAL_START, endNodeId);
    const points: LatLng[] = nodePath
      .map(id => virtCoords[id] ?? MERGED.coords[id])
      .filter((p): p is LatLng => !!p);

    if (points.length < 2) return null;

    let len = 0;
    for (let i = 1; i < points.length; i++) len += distanceTo(points[i - 1], points[i]);

    return { path: points, lengthM: Math.round(len) };
  } catch {
    return null;
  }
}
