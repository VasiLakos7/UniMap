const fs = require("fs");

const input = process.argv[2] || "./src/assets/OSM/campus_clean.geojson";
const DECIMALS = 6;

function key(lat, lng) {
  return `${lat.toFixed(DECIMALS)},${lng.toFixed(DECIMALS)}`;
}
function mkId(n) {
  return `N${String(n).padStart(4, "0")}`;
}

const gj = JSON.parse(fs.readFileSync(input, "utf8"));
const feats = Array.isArray(gj.features) ? gj.features : [];

const nodeKeyToId = new Map();
const nodes = []; // {id,lat,lng}
function getNodeId(lat, lng) {
  const k = key(lat, lng);
  if (nodeKeyToId.has(k)) return nodeKeyToId.get(k);
  const id = mkId(nodes.length + 1);
  nodeKeyToId.set(k, id);
  nodes.push({ id, lat, lng });
  return id;
}

const adj = new Map(); // id -> Set(id)
function addEdge(a, b) {
  if (a === b) return;
  if (!adj.has(a)) adj.set(a, new Set());
  if (!adj.has(b)) adj.set(b, new Set());
  adj.get(a).add(b);
  adj.get(b).add(a);
}

let edges = 0;

for (const f of feats) {
  if (!f?.geometry || f.geometry.type !== "LineString") continue;
  const coords = f.geometry.coordinates || [];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const a = getNodeId(lat1, lng1);
    const b = getNodeId(lat2, lng2);
    // count unique undirected edges using string key
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    // naive set to prevent double-counting
    if (!global._edgeSet) global._edgeSet = new Set();
    if (!global._edgeSet.has(k)) {
      global._edgeSet.add(k);
      edges++;
      addEdge(a, b);
    }
  }
}

// Connected components
const seen = new Set();
const comps = [];

for (const n of nodes) {
  if (seen.has(n.id)) continue;
  const stack = [n.id];
  seen.add(n.id);
  let size = 0;

  while (stack.length) {
    const cur = stack.pop();
    size++;
    const nb = adj.get(cur);
    if (!nb) continue;
    for (const v of nb) {
      if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
  }
  comps.push(size);
}

comps.sort((a,b)=>b-a);

let degMin = Infinity, degMax = 0, degSum = 0, isolated = 0;
for (const n of nodes) {
  const d = adj.get(n.id)?.size ?? 0;
  if (d === 0) isolated++;
  degMin = Math.min(degMin, d);
  degMax = Math.max(degMax, d);
  degSum += d;
}

console.log("Nodes:", nodes.length);
console.log("Edges:", edges);
console.log("Components:", comps.length, "Largest:", comps[0]);
console.log("Degree min/max/avg:", degMin, degMax, (degSum / nodes.length).toFixed(2));
console.log("Isolated nodes:", isolated);
