"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNodeIdForName = getNodeIdForName;
exports.getNodeCoords = getNodeCoords;
exports.findNearestNodeId = findNearestNodeId;
exports.calculatePath = calculatePath;
exports.calculatePathWithLength = calculatePathWithLength;
exports.findBestStartNode = findBestStartNode;
const dijkstrajs_1 = require("dijkstrajs");
const osm_nodes_1 = require("../data/osm-nodes");
const manual_nodes_1 = require("../data/manual-nodes");
const poi_nodes_1 = require("../data/poi-nodes");
const geo_1 = require("./geo");
const accessibility_1 = require("./accessibility");
// -------------------------------------------------------
// Normalizer ονομάτων
// -------------------------------------------------------
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
// -------------------------------------------------------
// Graph building utilities
// -------------------------------------------------------
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
    splitEdgeWithChain(g, ALL, 'N0058', 'N0059', ['M_58_TO_59_1']);
    splitEdgeWithChain(g, ALL, 'N0036', 'N0067', ['M_36_TO_67_PRE_1', 'M_36_TO_67_1']);
    const baseIds = [...keptOSMIds, ...manualIds];
    healCloseNodes(baseIds, ALL, g, 6);
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
    return { coords: ALL, adjacency: g, snapCandidates };
}
// -------------------------------------------------------
// Singleton — φτιάχνεται μία φορά
// -------------------------------------------------------
(0, accessibility_1.registerAccessibilityEdges)();
const MERGED = buildMergedGraph();
// -------------------------------------------------------
// Wheelchair-filtered graph (lazy)
// -------------------------------------------------------
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
// -------------------------------------------------------
// Public API
// -------------------------------------------------------
const MAX_SNAP_METERS = 90;
const MAX_START_RADIUS = 120;
function getNodeIdForName(destinationName) {
    return poi_nodes_1.POI_ALIAS.get(norm(destinationName)) ?? null;
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
    try {
        const g = getAdjacency(!!opts?.wheelchair);
        const nodePath = (0, dijkstrajs_1.find_path)(g, startNodeId, endNodeId);
        return nodePath.map((id) => MERGED.coords[id]).filter(Boolean);
    }
    catch {
        return null;
    }
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
function findBestStartNode(lat, lng, endNodeId, opts) {
    const here = { lat, lng };
    const candidates = getSnapCandidates(!!opts?.wheelchair);
    const cache = new Map();
    let bestNode = null;
    let bestCost = Infinity;
    for (const id of candidates) {
        const ll = MERGED.coords[id];
        if (!ll)
            continue;
        const dUser = (0, geo_1.distanceTo)(here, ll);
        if (dUser > MAX_START_RADIUS)
            continue;
        let pathLen = cache.get(id);
        if (pathLen === undefined) {
            const res = calculatePathWithLength(id, endNodeId, opts);
            pathLen = res ? res.lengthM : Infinity;
            cache.set(id, pathLen);
        }
        if (pathLen === Infinity)
            continue;
        // Penalise straight-line distance (real walking paths are ~1.5× longer than crow-flies)
        const cost = dUser * 1.5 + pathLen;
        if (cost < bestCost) {
            bestCost = cost;
            bestNode = id;
        }
    }
    return bestNode;
}
