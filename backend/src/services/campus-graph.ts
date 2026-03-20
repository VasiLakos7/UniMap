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
const VIRTUAL_CONNECT_K = 3; // top-K nearest nodes to connect the virtual node

/**
 * Calculates a route from the user's exact GPS position to endNodeId.
 * A virtual node is injected at (lat, lng), connected to the K nearest
 * snap candidates, so the returned path starts at the user's real position
 * with no diagonal offset.
 */
export function calculateRouteFromPosition(
  lat: number,
  lng: number,
  endNodeId: string,
  opts?: { wheelchair?: boolean }
): RouteResult | null {
  const here: LatLng = { lat, lng };
  const candidates = getSnapCandidates(!!opts?.wheelchair);

  // Find K nearest reachable candidates
  const nearest = candidates
    .map(id => ({ id, d: distanceTo(here, MERGED.coords[id] ?? here) }))
    .filter(x => x.d <= MAX_START_RADIUS && MERGED.coords[x.id])
    .sort((a, b) => a.d - b.d)
    .slice(0, VIRTUAL_CONNECT_K);

  if (nearest.length === 0) return null;

  const baseAdj = getAdjacency(!!opts?.wheelchair);

  // Shallow-copy adjacency and inject virtual node (outgoing edges only)
  const adj: Adjacency = { ...baseAdj, [VIRTUAL_START]: {} };
  for (const { id, d } of nearest) {
    adj[VIRTUAL_START][id] = Math.round(d) || 1;
  }

  try {
    const nodePath: string[] = find_path(adj, VIRTUAL_START, endNodeId);
    const points: LatLng[] = nodePath.map(id =>
      id === VIRTUAL_START ? here : MERGED.coords[id]
    ).filter((p): p is LatLng => !!p);

    if (points.length < 2) return null;

    let len = 0;
    for (let i = 1; i < points.length; i++) len += distanceTo(points[i - 1], points[i]);

    return { path: points, lengthM: Math.round(len) };
  } catch {
    return null;
  }
}
