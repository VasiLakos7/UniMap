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
  healCloseNodes(baseIds, ALL, g, 1.5);

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

// Returns true if segments p1-p2 and p3-p4 properly cross (not just touch at endpoints)
function segmentsProperlyIntersect(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const cross = (o: LatLng, a: LatLng, b: LatLng): number =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Count how many graph edges the segment from→to crosses (excluding the target edge skipU-skipV).
// Each crossing likely means the approach passes through a non-walkable area (building/obstacle).
function countApproachCrossings(
  from: LatLng, to: LatLng,
  skipU: string, skipV: string,
  adj: Adjacency, coords: Record<string, LatLng>
): number {
  let n = 0;
  const seen = new Set<string>();
  for (const u of Object.keys(adj)) {
    const a = coords[u];
    if (!a) continue;
    for (const v of Object.keys(adj[u])) {
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if ((u === skipU && v === skipV) || (u === skipV && v === skipU)) continue;
      const b = coords[v];
      if (!b) continue;
      if (segmentsProperlyIntersect(from, to, a, b)) n++;
    }
  }
  return n;
}


// Public API
const MAX_SNAP_METERS = 90;
const MAX_START_RADIUS = 80;


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

/**
 * Projects point p onto segment a-b.
 * Returns the projection LatLng, parameter t (0-1 along segment), and perpendicular distance.
 * Returns null if projection falls outside the segment (t ≤ 0.02 or t ≥ 0.98).
 */
function projectPointOntoSegment(
  p: LatLng, a: LatLng, b: LatLng
): { proj: LatLng; t: number; perpM: number } | null {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return null;
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
  if (t <= 0.02 || t >= 0.98) return null;
  const proj: LatLng = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  return { proj, t, perpM: distanceTo(p, proj) };
}

/**
 * Calculates a route from the user's exact GPS position to endNodeId.
 *
 * Strategy:
 * 1. Connects __USER__ to nearby graph nodes (existing behaviour).
 * 2. Additionally, for every graph edge close to the user, projects the user's
 *    position onto that edge and injects a virtual projection node __PROJ_U_V__.
 *    __PROJ_U_V__ connects to both edge endpoints with the correct sub-edge
 *    distances, so Dijkstra can choose the correct direction along the edge
 *    instead of blindly routing to the nearest endpoint.
 *
 * This fixes the "wrong initial direction" bug that occurred when the user was
 * standing between two nodes: without projection, the route would start toward
 * the nearest node regardless of which direction leads to the destination.
 */
export function calculateRouteFromPosition(
  lat: number,
  lng: number,
  endNodeId: string,
  opts?: { wheelchair?: boolean }
): RouteResult | null {
  const here: LatLng = { lat, lng };
  const baseAdj = getAdjacency(!!opts?.wheelchair);
  const snapCands = getSnapCandidates(!!opts?.wheelchair);

  const CROSSING_PENALTY_M = 150;
  const MAX_CONNECT_NODES = 4;
  const MAX_PROJ_DIST_M = 25;   // max perpendicular distance to snap onto an edge
  const MAX_PROJ_NODES = 3;     // top projection candidates to inject
  // POI entrance nodes are only valid start-snap targets when the user is
  // literally standing at the entrance.  Using them beyond this radius causes
  // routes to appear to start from the wrong building's entrance.
  const MAX_POI_START_RADIUS_M = 5;

  const poiIdSet = new Set(Object.keys(POI_NODE_COORDS));

  // --- 1. Node candidates ---
  type Candidate = { id: string; distM: number; score: number; crossings: number };
  const candidates: Candidate[] = [];

  for (const id of snapCands) {
    const nodeLL = MERGED.coords[id];
    if (!nodeLL) continue;
    const distM = distanceTo(here, nodeLL);
    const maxRadius = poiIdSet.has(id) ? MAX_POI_START_RADIUS_M : MAX_START_RADIUS;
    if (distM > maxRadius) continue;
    const crossings = countApproachCrossings(here, nodeLL, '', '', baseAdj, MERGED.coords);
    const score = distM + crossings * CROSSING_PENALTY_M;
    candidates.push({ id, distM, score, crossings });
  }

  // Prefer nodes reachable without crossing any graph edge (wall-free approach).
  // If no clean candidates exist, use only the single nearest to limit wall crossings.
  const cleanCandidates = candidates.filter(c => c.crossings === 0);
  let top: Candidate[];
  if (cleanCandidates.length > 0) {
    cleanCandidates.sort((a, b) => a.score - b.score);
    top = cleanCandidates.slice(0, MAX_CONNECT_NODES);
  } else if (candidates.length > 0) {
    candidates.sort((a, b) => a.score - b.score);
    top = [candidates[0]]; // single nearest fallback only
  } else {
    top = [];
  }

  // --- 2. Edge projection candidates ---
  type ProjCandidate = {
    projId: string;
    proj: LatLng;
    nodeU: string;
    nodeV: string;
    distU: number;
    distV: number;
    perpM: number;
  };
  const projCandidates: ProjCandidate[] = [];
  const seenEdges = new Set<string>();

  for (const u of Object.keys(baseAdj)) {
    // Skip edges that touch a non-destination POI entrance — projecting onto
    // them would make the route appear to start from the wrong building's door.
    if (poiIdSet.has(u) && u !== endNodeId) continue;
    const a = MERGED.coords[u];
    if (!a) continue;
    for (const v of Object.keys(baseAdj[u])) {
      if (poiIdSet.has(v) && v !== endNodeId) continue;
      const key = u < v ? `${u}|${v}` : `${v}|${u}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      const b = MERGED.coords[v];
      if (!b) continue;
      const res = projectPointOntoSegment(here, a, b);
      if (!res || res.perpM > MAX_PROJ_DIST_M) continue;
      const edgeLen = distanceTo(a, b);
      projCandidates.push({
        projId: `__PROJ_${u}_${v}__`,
        proj: res.proj,
        nodeU: u,
        nodeV: v,
        distU: res.t * edgeLen,
        distV: (1 - res.t) * edgeLen,
        perpM: res.perpM,
      });
    }
  }

  projCandidates.sort((a, b) => a.perpM - b.perpM);
  const topProj = projCandidates.slice(0, MAX_PROJ_NODES);

  // If projection candidates exist, suppress direct node connections entirely:
  // the projection point is guaranteed to lie ON a verified walkable edge, so
  // connecting to it never jumps over a wall.  Direct node connections are only
  // used when there is no nearby edge to project onto.
  const activeTop = topProj.length > 0 ? [] : top;

  if (activeTop.length === 0 && topProj.length === 0) return null;

  // --- 3. Build augmented adjacency ---
  const adj: Adjacency = { ...baseAdj, [VIRTUAL_START]: {} };
  const virtCoords: Record<string, LatLng> = { [VIRTUAL_START]: here };

  for (const c of activeTop) {
    adj[VIRTUAL_START][c.id] = Math.round(c.distM) || 1;
  }

  for (const pc of topProj) {
    virtCoords[pc.projId] = pc.proj;
    adj[pc.projId] = {
      [pc.nodeU]: Math.round(pc.distU) || 1,
      [pc.nodeV]: Math.round(pc.distV) || 1,
    };
    adj[VIRTUAL_START][pc.projId] = Math.round(pc.perpM) || 1;
  }

  try {
    const nodePath: string[] = find_path(adj, VIRTUAL_START, endNodeId);
    // Skip VIRTUAL_START (user's raw GPS position): the frontend handles the
    // approach segment separately as a grey dashed line, so the returned path
    // must contain only real graph points.  Including the raw GPS position
    // caused a straight blue line from the user through walls to the first node.
    const points: LatLng[] = nodePath
      .slice(1)
      .map(id => virtCoords[id] ?? MERGED.coords[id])
      .filter((p): p is LatLng => !!p);

    if (points.length < 1) return null;

    let len = 0;
    for (let i = 1; i < points.length; i++) len += distanceTo(points[i - 1], points[i]);

    return { path: points, lengthM: Math.round(len) };
  } catch {
    return null;
  }
}
