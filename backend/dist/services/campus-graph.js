"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeIdForName = getNodeIdForName;
exports.getAccessibleAlt = getAccessibleAlt;
exports.getNodeCoords = getNodeCoords;
exports.findNearestNodeId = findNearestNodeId;
exports.calculatePath = calculatePath;
exports.calculatePathWithLength = calculatePathWithLength;
exports.calculateRouteFromPosition = calculateRouteFromPosition;
const osm_nodes_1 = require("../data/osm-nodes");
const manual_nodes_1 = require("../data/manual-nodes");
const poi_nodes_1 = require("../data/poi-nodes");
const geo_1 = require("./geo");
const accessibility_1 = require("./accessibility");
// Normalizer ονομάτων
function norm(s) {
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
function computeBBox(points) {
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
    }
    return { minLat, maxLat, minLng, maxLng };
}
function inBBox(p, bb) {
    return p.lat >= bb.minLat && p.lat <= bb.maxLat && p.lng >= bb.minLng && p.lng <= bb.maxLng;
}
function addUndirectedEdge(g, coords, u, v) {
    const a = coords[u];
    const b = coords[v];
    if (!a || !b)
        return;
    const w = Math.max(1, Math.round((0, geo_1.distanceTo)(a, b)));
    if (!g[u])
        g[u] = {};
    if (!g[v])
        g[v] = {};
    g[u][v] = Math.min(g[u][v] ?? Infinity, w);
    g[v][u] = Math.min(g[v][u] ?? Infinity, w);
}
function removeUndirectedEdge(g, u, v) {
    if (g[u])
        delete g[u][v];
    if (g[v])
        delete g[v][u];
}
function buildAdjacencyFromEdges(edges, coords) {
    const g = {};
    for (const [u, v] of edges)
        addUndirectedEdge(g, coords, u, v);
    return g;
}
function splitEdgeWithChain(g, coords, a, b, chain) {
    removeUndirectedEdge(g, a, b);
    let prev = a;
    for (const mid of chain) {
        addUndirectedEdge(g, coords, prev, mid);
        prev = mid;
    }
    addUndirectedEdge(g, coords, prev, b);
}
function healCloseNodes(ids, coords, g, maxDistM) {
    for (let i = 0; i < ids.length; i++) {
        const aId = ids[i];
        const a = coords[aId];
        if (!a)
            continue;
        for (let j = i + 1; j < ids.length; j++) {
            const bId = ids[j];
            const b = coords[bId];
            if (!b)
                continue;
            if ((0, geo_1.distanceTo)(a, b) <= maxDistM)
                addUndirectedEdge(g, coords, aId, bId);
        }
    }
}
function getLargestComponent(ids, g) {
    const seen = new Set();
    let best = new Set();
    for (const start of ids) {
        if (seen.has(start))
            continue;
        const comp = new Set();
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const u = stack.pop();
            comp.add(u);
            for (const v of Object.keys(g[u] ?? {})) {
                if (!seen.has(v)) {
                    seen.add(v);
                    stack.push(v);
                }
            }
        }
        if (comp.size > best.size)
            best = comp;
    }
    return best;
}
function findNearestInSet(lat, lng, ids, coords) {
    const here = { lat, lng };
    let bestId = null;
    let bestDist = Infinity;
    for (const id of ids) {
        const c = coords[id];
        if (!c)
            continue;
        const d = (0, geo_1.distanceTo)(here, c);
        if (d < bestDist) {
            bestDist = d;
            bestId = id;
        }
    }
    return { id: bestId, distM: bestDist };
}
function buildMergedGraph() {
    const seedPoints = [
        ...Object.values(poi_nodes_1.POI_NODE_COORDS),
        ...Object.values(manual_nodes_1.MANUAL_NODE_COORDS),
    ];
    const bb0 = computeBBox(seedPoints);
    const MARGIN = 0.0022;
    const bb = {
        minLat: bb0.minLat - MARGIN,
        maxLat: bb0.maxLat + MARGIN,
        minLng: bb0.minLng - MARGIN,
        maxLng: bb0.maxLng + MARGIN,
    };
    const keptOSM = {};
    for (const [id, ll] of Object.entries(osm_nodes_1.OSM_NODE_COORDS)) {
        if (inBBox(ll, bb))
            keptOSM[id] = ll;
    }
    const keptOSMIds = Object.keys(keptOSM);
    const keptEdges = osm_nodes_1.OSM_EDGES.filter(([u, v]) => keptOSM[u] && keptOSM[v]);
    const manualIds = Object.keys(manual_nodes_1.MANUAL_NODE_COORDS);
    const ALL = {
        ...keptOSM,
        ...manual_nodes_1.MANUAL_NODE_COORDS,
        ...poi_nodes_1.POI_NODE_COORDS,
    };
    const g = buildAdjacencyFromEdges(keptEdges, ALL);
    for (const [u, v] of manual_nodes_1.MANUAL_EDGES)
        addUndirectedEdge(g, ALL, u, v);
    splitEdgeWithChain(g, ALL, 'N0068', 'N0060', ['M_68_TO_BOTTOM_1', 'M_BOTTOM_MID', 'M_BOTTOM_TO_60_1']);
    splitEdgeWithChain(g, ALL, 'N0060', 'N0069', ['M_60_TO_69_1']);
    splitEdgeWithChain(g, ALL, 'N0108', 'N0052', ['M_0108_TO_0052_1']);
    splitEdgeWithChain(g, ALL, 'N0058', 'N0059', ['M_58_TO_59_1', 'N0161']);
    splitEdgeWithChain(g, ALL, 'N0043', 'N0044', ['M_DIET_AXIS']);
    splitEdgeWithChain(g, ALL, 'N0036', 'N0067', ['M_36_TO_67_PRE_1', 'M_36_TO_67_1']);
    const baseIds = [...keptOSMIds, ...manualIds];
    healCloseNodes(baseIds, ALL, g, 1.5);
    const largest = getLargestComponent(baseIds, g);
    const snapCandidates = baseIds.filter((id) => largest.has(id));
    for (const [poiId, poiLL] of Object.entries(poi_nodes_1.POI_NODE_COORDS)) {
        const { id: nearId, distM } = findNearestInSet(poiLL.lat, poiLL.lng, snapCandidates, ALL);
        if (!nearId) {
            console.warn(`[CampusGraph] POI ${poiId} δεν βρήκε κοντινό node.`);
            continue;
        }
        if (distM > 60)
            console.warn(`[CampusGraph] POI ${poiId} είναι ${Math.round(distM)}m από το ${nearId}.`);
        addUndirectedEdge(g, ALL, poiId, nearId);
    }
    // POI entrance nodes συμμετέχουν ως snap candidates: αν ο χρήστης
    // είναι πλησιέστερα σε είσοδο κτιρίου από οποιονδήποτε άλλο node,
    // η διαδρομή ξεκινά από εκεί (φυσική συμπεριφορά, χωρίς magic radius).
    const poiIds = Object.keys(poi_nodes_1.POI_NODE_COORDS);
    const allSnapCandidates = [...snapCandidates, ...poiIds];
    return { coords: ALL, adjacency: g, snapCandidates: allSnapCandidates };
}
// Singleton — φτιάχνεται μία φορά
(0, accessibility_1.registerAccessibilityEdges)();
const MERGED = buildMergedGraph();
// Wheelchair-filtered graph (lazy)
let wheelchairAdj;
let wheelchairSnap;
function getAdjacency(wheelchair) {
    if (!wheelchair)
        return MERGED.adjacency;
    if (wheelchairAdj)
        return wheelchairAdj;
    const filtered = {};
    for (const [u, nbrs] of Object.entries(MERGED.adjacency)) {
        for (const [v, w] of Object.entries(nbrs)) {
            if (!(0, accessibility_1.edgeAllowedForWheelchair)((0, accessibility_1.getEdgeTag)(u, v)))
                continue;
            (filtered[u] ?? (filtered[u] = {}))[v] = w;
        }
    }
    wheelchairAdj = filtered;
    return filtered;
}
function getSnapCandidates(wheelchair) {
    if (!wheelchair)
        return MERGED.snapCandidates;
    if (wheelchairSnap)
        return wheelchairSnap;
    const g = getAdjacency(true);
    wheelchairSnap = MERGED.snapCandidates.filter((id) => g[id] && Object.keys(g[id]).length > 0);
    return wheelchairSnap;
}
// Returns true if segments p1-p2 and p3-p4 properly cross (not just touch at endpoints)
function segmentsProperlyIntersect(p1, p2, p3, p4) {
    const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    const d1 = cross(p3, p4, p1);
    const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3);
    const d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// Count how many graph edges the segment from→to crosses (excluding the target edge skipU-skipV).
// Each crossing likely means the approach passes through a non-walkable area (building/obstacle).
function countApproachCrossings(from, to, skipU, skipV, adj, coords) {
    let n = 0;
    const seen = new Set();
    for (const u of Object.keys(adj)) {
        const a = coords[u];
        if (!a)
            continue;
        for (const v of Object.keys(adj[u])) {
            const key = u < v ? `${u}|${v}` : `${v}|${u}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            if ((u === skipU && v === skipV) || (u === skipV && v === skipU))
                continue;
            const b = coords[v];
            if (!b)
                continue;
            if (segmentsProperlyIntersect(from, to, a, b))
                n++;
        }
    }
    return n;
}
class MinHeap {
    constructor() {
        this.heap = [];
    }
    push(f, id) {
        this.heap.push([f, id]);
        this._bubbleUp(this.heap.length - 1);
    }
    pop() {
        if (this.heap.length === 0)
            return undefined;
        const top = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this._sinkDown(0);
        }
        return top;
    }
    get size() { return this.heap.length; }
    _bubbleUp(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.heap[p][0] <= this.heap[i][0])
                break;
            [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
            i = p;
        }
    }
    _sinkDown(i) {
        const n = this.heap.length;
        for (;;) {
            let s = i;
            const l = 2 * i + 1, r = l + 1;
            if (l < n && this.heap[l][0] < this.heap[s][0])
                s = l;
            if (r < n && this.heap[r][0] < this.heap[s][0])
                s = r;
            if (s === i)
                break;
            [this.heap[s], this.heap[i]] = [this.heap[i], this.heap[s]];
            i = s;
        }
    }
}
function aStarPath(adj, coords, startId, endId) {
    const destLL = coords[endId];
    const h = (id) => {
        const c = coords[id];
        return c && destLL ? (0, geo_1.distanceTo)(c, destLL) : 0;
    };
    const gScore = { [startId]: 0 };
    const prev = {};
    const closed = new Set();
    const open = new MinHeap();
    open.push(h(startId), startId);
    while (open.size > 0) {
        const [, current] = open.pop();
        if (closed.has(current))
            continue;
        closed.add(current);
        if (current === endId) {
            const path = [];
            let c = endId;
            while (c !== undefined) {
                path.unshift(c);
                c = prev[c];
            }
            return path;
        }
        for (const [neighbor, edgeCost] of Object.entries(adj[current] ?? {})) {
            if (closed.has(neighbor))
                continue;
            const tentativeG = (gScore[current] ?? Infinity) + edgeCost;
            if (tentativeG < (gScore[neighbor] ?? Infinity)) {
                prev[neighbor] = current;
                gScore[neighbor] = tentativeG;
                open.push(tentativeG + h(neighbor), neighbor);
            }
        }
    }
    return null;
}
// Public API
const MAX_SNAP_METERS = 90;
const MAX_START_RADIUS = 80;
function getNodeIdForName(destinationName) {
    return poi_nodes_1.POI_ALIAS.get(norm(destinationName)) ?? null;
}
function getAccessibleAlt(nodeId) {
    return poi_nodes_1.POI_ACCESSIBLE_ALT[nodeId] ?? null;
}
function getNodeCoords(nodeId) {
    return MERGED.coords[nodeId];
}
function findNearestNodeId(lat, lng, opts) {
    const here = { lat, lng };
    const candidates = getSnapCandidates(!!opts?.wheelchair);
    let bestId = null;
    let bestDist = Infinity;
    for (const id of candidates) {
        const ll = MERGED.coords[id];
        if (!ll)
            continue;
        const d = (0, geo_1.distanceTo)(here, ll);
        if (d < bestDist) {
            bestDist = d;
            bestId = id;
        }
    }
    return bestDist <= MAX_SNAP_METERS ? bestId : null;
}
function calculatePath(startNodeId, endNodeId, opts) {
    const g = getAdjacency(!!opts?.wheelchair);
    const nodePath = aStarPath(g, MERGED.coords, startNodeId, endNodeId);
    if (!nodePath)
        return null;
    return nodePath.map((id) => MERGED.coords[id]).filter(Boolean);
}
function calculatePathWithLength(startNodeId, endNodeId, opts) {
    const points = calculatePath(startNodeId, endNodeId, opts);
    if (!points || points.length < 2)
        return null;
    let len = 0;
    for (let i = 1; i < points.length; i++)
        len += (0, geo_1.distanceTo)(points[i - 1], points[i]);
    return { path: points, lengthM: Math.round(len) };
}
const VIRTUAL_START = '__USER__';
/**
 * Projects point p onto segment a-b.
 * Returns the projection LatLng, parameter t (0-1 along segment), and perpendicular distance.
 * Returns null if projection falls outside the segment (t ≤ 0.02 or t ≥ 0.98).
 */
function projectPointOntoSegment(p, a, b) {
    const dx = b.lng - a.lng;
    const dy = b.lat - a.lat;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-18)
        return null;
    const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
    if (t <= 0.02 || t >= 0.98)
        return null;
    const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx };
    return { proj, t, perpM: (0, geo_1.distanceTo)(p, proj) };
}
/**
 * Calculates a route from the user's exact GPS position to endNodeId.
 *
 * Strategy:
 * 1. Connects __USER__ to nearby graph nodes (existing behaviour).
 * 2. Additionally, for every graph edge close to the user, projects the user's
 *    position onto that edge and injects a virtual projection node __PROJ_U_V__.
 *    __PROJ_U_V__ connects to both edge endpoints with the correct sub-edge
 *    distances, so A* can choose the correct direction along the edge
 *    instead of blindly routing to the nearest endpoint.
 *
 * This fixes the "wrong initial direction" bug that occurred when the user was
 * standing between two nodes: without projection, the route would start toward
 * the nearest node regardless of which direction leads to the destination.
 */
function calculateRouteFromPosition(lat, lng, endNodeId, opts) {
    const here = { lat, lng };
    const baseAdj = getAdjacency(!!opts?.wheelchair);
    const snapCands = getSnapCandidates(!!opts?.wheelchair);
    const CROSSING_PENALTY_M = 9999;
    const MAX_CONNECT_NODES = 4;
    const MAX_PROJ_DIST_M = 25; // max perpendicular distance to snap onto an edge
    const MAX_PROJ_NODES = 3; // top projection candidates to inject
    // POI entrance nodes are only valid start-snap targets when the user is
    // literally standing at the entrance.  Using them beyond this radius causes
    // routes to appear to start from the wrong building's entrance.
    const MAX_POI_START_RADIUS_M = 5;
    const poiIdSet = new Set(Object.keys(poi_nodes_1.POI_NODE_COORDS));
    // POI entrance edges (e.g. SDO_ENT↔M_36_TO_67_PRE_1) are short dead-end stubs,
    // not building walls. Including them in crossing detection causes approach lines
    // to nearby nodes to be falsely penalised, forcing the route onto a detour.
    const nonPoiAdj = {};
    for (const [u, nbrs] of Object.entries(baseAdj)) {
        if (poiIdSet.has(u))
            continue;
        const filtered = {};
        for (const [v, w] of Object.entries(nbrs)) {
            if (!poiIdSet.has(v))
                filtered[v] = w;
        }
        if (Object.keys(filtered).length > 0)
            nonPoiAdj[u] = filtered;
    }
    const candidates = [];
    for (const id of snapCands) {
        const nodeLL = MERGED.coords[id];
        if (!nodeLL)
            continue;
        const distM = (0, geo_1.distanceTo)(here, nodeLL);
        const maxRadius = poiIdSet.has(id) ? MAX_POI_START_RADIUS_M : MAX_START_RADIUS;
        if (distM > maxRadius)
            continue;
        const crossings = countApproachCrossings(here, nodeLL, '', '', nonPoiAdj, MERGED.coords);
        const score = distM + crossings * CROSSING_PENALTY_M;
        candidates.push({ id, distM, score, crossings });
    }
    // Sort all candidates by score (distM + crossings * penalty).
    // Clean nodes (0 crossings) naturally rank first; crossed nodes are still
    // included so A* can pick the optimal start rather than being forced onto a
    // distant clean node that creates a detour.
    candidates.sort((a, b) => a.score - b.score);
    const top = candidates.length > 0 ? candidates.slice(0, MAX_CONNECT_NODES) : [];
    const cleanCandidates = candidates.filter(c => c.crossings === 0); // already sorted
    const projCandidates = [];
    const seenEdges = new Set();
    for (const u of Object.keys(baseAdj)) {
        const a = MERGED.coords[u];
        if (!a)
            continue;
        for (const v of Object.keys(baseAdj[u])) {
            const key = u < v ? `${u}|${v}` : `${v}|${u}`;
            if (seenEdges.has(key))
                continue;
            seenEdges.add(key);
            const b = MERGED.coords[v];
            if (!b)
                continue;
            const res = projectPointOntoSegment(here, a, b);
            if (!res || res.perpM > MAX_PROJ_DIST_M)
                continue;
            if (countApproachCrossings(here, res.proj, u, v, nonPoiAdj, MERGED.coords) > 0)
                continue;
            const edgeLen = (0, geo_1.distanceTo)(a, b);
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
    // When clean (wall-free) node candidates exist, use only them — never mix in
    // crossed candidates. Crossed candidates are used only as a last resort when
    // no clean approach exists at all.
    const activeTop = (() => {
        if (topProj.length > 0 && cleanCandidates.length === 0)
            return [];
        return cleanCandidates.length > 0
            ? cleanCandidates.slice(0, MAX_CONNECT_NODES)
            : top;
    })();
    if (activeTop.length === 0 && topProj.length === 0)
        return null;
    // --- 3. Build augmented adjacency ---
    const adj = { ...baseAdj, [VIRTUAL_START]: {} };
    const virtCoords = { [VIRTUAL_START]: here };
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
    const allCoords = { ...MERGED.coords, ...virtCoords };
    const nodePath = aStarPath(adj, allCoords, VIRTUAL_START, endNodeId);
    if (!nodePath)
        return null;
    // Non-destination POI nodes and projection nodes on POI edges are omitted
    // so the route doesn't hop through a wrong building entrance.
    const graphPoints = nodePath
        .slice(1)
        .map(id => {
        if (poiIdSet.has(id) && id !== endNodeId)
            return null;
        if (id.startsWith('__PROJ_')) {
            const pc = topProj.find(p => p.projId === id);
            if (pc) {
                const uOther = poiIdSet.has(pc.nodeU) && pc.nodeU !== endNodeId;
                const vOther = poiIdSet.has(pc.nodeV) && pc.nodeV !== endNodeId;
                if (uOther || vOther)
                    return null;
            }
        }
        return allCoords[id];
    })
        .filter((p) => !!p);
    if (graphPoints.length < 1)
        return null;
    // Prepend the user's exact GPS position so the route starts from there.
    // The segment here→graphPoints[0] is already validated as wall-free above.
    const points = [here, ...graphPoints];
    let len = 0;
    for (let i = 1; i < points.length; i++)
        len += (0, geo_1.distanceTo)(points[i - 1], points[i]);
    return { path: points, lengthM: Math.round(len) };
}
