const fs = require("fs");

const input = process.argv[2] || "./src/assets/OSM/campus_clean.geojson";
const outTs = process.argv[3] || "./src/app/services/osm/campus-osm-graph.ts";

// πόσα δεκαδικά για “ένωση” ίδιων σημείων (6=πολύ ακριβές, 5=πιο “κολλάει”)
const DECIMALS = 6;

// κόβει μηδαμινά segments (π.χ. 0m/1m) για να μην γεμίζει σκουπίδια
const MIN_EDGE_METERS = 1;

// haversine distance (m) για φιλτράρισμα + optional weights
function distMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function key(lat, lng) {
  return `${lat.toFixed(DECIMALS)},${lng.toFixed(DECIMALS)}`;
}

function mkId(n) {
  return `N${String(n).padStart(4, "0")}`;
}

const gj = JSON.parse(fs.readFileSync(input, "utf8"));
const feats = Array.isArray(gj.features) ? gj.features : [];

// 1) nodes: merge same coords
const nodeKeyToId = new Map(); // "lat,lng" -> "N0001"
const nodes = []; // { id, lat, lng }

function getNodeId(lat, lng) {
  const k = key(lat, lng);
  const existing = nodeKeyToId.get(k);
  if (existing) return existing;

  const id = mkId(nodes.length + 1);
  nodeKeyToId.set(k, id);
  nodes.push({
    id,
    lat: Number(lat.toFixed(DECIMALS)),
    lng: Number(lng.toFixed(DECIMALS)),
  });
  return id;
}

// 2) edges: from every LineString segment
const edgesSet = new Set(); // store "A|B" undirected unique
function addEdge(a, b) {
  if (a === b) return;
  const k1 = `${a}|${b}`;
  const k2 = `${b}|${a}`;
  if (!edgesSet.has(k1) && !edgesSet.has(k2)) edgesSet.add(k1);
}

for (const f of feats) {
  if (!f?.geometry || f.geometry.type !== "LineString") continue;

  const coords = f.geometry.coordinates || [];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];

    const a = { lat: Number(lat1), lng: Number(lng1) };
    const b = { lat: Number(lat2), lng: Number(lng2) };
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) continue;
    if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue;

    const d = distMeters(a, b);
    if (d < MIN_EDGE_METERS) continue;

    const idA = getNodeId(a.lat, a.lng);
    const idB = getNodeId(b.lat, b.lng);
    addEdge(idA, idB);
  }
}

const edges = Array.from(edgesSet).map((s) => s.split("|")); // [ [A,B], ... ]

// 3) generate TS file
let ts = "";
ts += `import * as L from 'leaflet';\n\n`;
ts += `// AUTO-GENERATED from: ${input}\n`;
ts += `// Nodes: ${nodes.length}, Edges: ${edges.length}\n\n`;

ts += `export const nodeCoords = {\n`;
for (const n of nodes) {
  ts += `  ${n.id}: L.latLng(${n.lat}, ${n.lng}),\n`;
}
ts += `} as const;\n\n`;

ts += `export type NodeId = keyof typeof nodeCoords;\n\n`;

ts += `export const UNDIRECTED_EDGES: Array<[NodeId, NodeId]> = [\n`;
for (const [a, b] of edges) {
  ts += `  ['${a}', '${b}'],\n`;
}
ts += `];\n\n`;

ts += `function distMeters(a: L.LatLng, b: L.LatLng): number {\n`;
ts += `  return a.distanceTo(b);\n`;
ts += `}\n\n`;

ts += `export function buildAdjacency(edges: Array<[NodeId, NodeId]>) {\n`;
ts += `  const g: Record<string, Record<string, number>> = {};\n`;
ts += `  const add = (u: NodeId, v: NodeId) => {\n`;
ts += `    const w = Math.max(1, Math.round(distMeters(nodeCoords[u], nodeCoords[v])));\n`;
ts += `    if (!g[u]) g[u] = {};\n`;
ts += `    g[u][v] = w;\n`;
ts += `  };\n`;
ts += `  for (const [u, v] of edges) { add(u, v); add(v, u); }\n`;
ts += `  return g;\n`;
ts += `}\n\n`;

ts += `export const campusGraphData = buildAdjacency(UNDIRECTED_EDGES);\n`;

fs.mkdirSync(require("path").dirname(outTs), { recursive: true });
fs.writeFileSync(outTs, ts, "utf8");

console.log(`OK ✅ Nodes: ${nodes.length} | Edges: ${edges.length}`);
console.log(`Saved -> ${outTs}`);
