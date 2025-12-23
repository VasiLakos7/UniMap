const fs = require("fs");

const input = process.argv[2] || "./src/assets/OSM/campus_clean.geojson";
const outGeo = process.argv[3] || "./src/assets/OSM/components.geojson";
const outJson = process.argv[4] || "./src/assets/OSM/components.json";

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
  const ex = nodeKeyToId.get(k);
  if (ex) return ex;

  const id = mkId(nodes.length + 1);
  nodeKeyToId.set(k, id);
  nodes.push({
    id,
    lat: Number(Number(lat).toFixed(DECIMALS)),
    lng: Number(Number(lng).toFixed(DECIMALS)),
  });
  return id;
}

const edgeSet = new Set();
const adj = new Map(); // id -> Set

function addAdj(a, b) {
  if (!adj.has(a)) adj.set(a, new Set());
  adj.get(a).add(b);
}

for (const f of feats) {
  if (!f?.geometry || f.geometry.type !== "LineString") continue;
  const coords = f.geometry.coordinates || [];
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];

    const a = getNodeId(lat1, lng1);
    const b = getNodeId(lat2, lng2);

    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeSet.has(k)) continue;
    edgeSet.add(k);

    addAdj(a, b);
    addAdj(b, a);
  }
}

// components (DFS)
const seen = new Set();
const comps = []; // { idx, nodes: [ {id,lat,lng} ], centroid:{lat,lng} }

for (const n of nodes) {
  if (seen.has(n.id)) continue;

  const stack = [n.id];
  const ids = [];
  seen.add(n.id);

  while (stack.length) {
    const cur = stack.pop();
    ids.push(cur);

    const nb = adj.get(cur);
    if (!nb) continue;
    for (const v of nb) {
      if (!seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    }
  }

  // build node objects + centroid
  const nodeObjs = ids.map(id => {
    const x = nodes.find(nn => nn.id === id);
    return x;
  }).filter(Boolean);

  let sumLat = 0, sumLng = 0;
  for (const x of nodeObjs) { sumLat += x.lat; sumLng += x.lng; }
  const centroid = nodeObjs.length
    ? { lat: +(sumLat / nodeObjs.length).toFixed(DECIMALS), lng: +(sumLng / nodeObjs.length).toFixed(DECIMALS) }
    : { lat: 0, lng: 0 };

  comps.push({ size: nodeObjs.length, nodes: nodeObjs, centroid });
}

comps.sort((a, b) => b.size - a.size);

// save JSON report
const report = comps.map((c, i) => ({
  component: i + 1,
  size: c.size,
  centroid: c.centroid,
  sample: c.nodes.slice(0, 12), // δείχνει τους πρώτους 12 κόμβους
  nodes: c.nodes,              // όλη η λίστα (αν θες μεγάλο αρχείο)
}));

fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

// save GEOJSON points (για visual debug)
const pointFeatures = [];
for (let i = 0; i < comps.length; i++) {
  const compId = i + 1;
  for (const n of comps[i].nodes) {
    pointFeatures.push({
      type: "Feature",
      properties: { component: compId, nodeId: n.id, size: comps[i].size },
      geometry: { type: "Point", coordinates: [n.lng, n.lat] }
    });
  }
}
const geo = { type: "FeatureCollection", features: pointFeatures };
fs.writeFileSync(outGeo, JSON.stringify(geo, null, 2), "utf8");

// console summary
console.log(`OK ✅ Components: ${comps.length}`);
console.log(`Largest: ${comps[0]?.size ?? 0}`);
for (let i = 0; i < Math.min(10, comps.length); i++) {
  console.log(
    `#${i + 1} size=${comps[i].size} centroid=(${comps[i].centroid.lat}, ${comps[i].centroid.lng})`
  );
}
console.log(`Saved JSON -> ${outJson}`);
console.log(`Saved GEO  -> ${outGeo}`);
