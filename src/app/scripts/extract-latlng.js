const fs = require("fs");

const input = process.argv[2] || "campus_clean.geojson";
const outJson = process.argv[3] || "campus_points.json";
const outCsv = process.argv[4] || "campus_points.csv";

// πόσα δεκαδικά να κρατάμε (6 = ~11cm). Βάλε 5 αν θες πιο “ένωση” σημείων.
const DECIMALS = 6;

function key(lat, lng) {
  return `${lat.toFixed(DECIMALS)},${lng.toFixed(DECIMALS)}`;
}

const data = JSON.parse(fs.readFileSync(input, "utf8"));
const feats = Array.isArray(data.features) ? data.features : [];

const map = new Map(); // key -> {lat,lng}

for (const f of feats) {
  if (!f?.geometry || f.geometry.type !== "LineString") continue;

  const coords = f.geometry.coordinates || [];
  for (const pair of coords) {
    if (!Array.isArray(pair) || pair.length < 2) continue;

    const lng = Number(pair[0]);
    const lat = Number(pair[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const k = key(lat, lng);
    if (!map.has(k)) {
      map.set(k, {
        lat: Number(lat.toFixed(DECIMALS)),
        lng: Number(lng.toFixed(DECIMALS)),
      });
    }
  }
}

const points = Array.from(map.values());

// JSON output
fs.writeFileSync(outJson, JSON.stringify(points, null, 2), "utf8");

// CSV output
const csv = ["lat,lng", ...points.map(p => `${p.lat},${p.lng}`)].join("\n");
fs.writeFileSync(outCsv, csv, "utf8");

console.log(`OK ✅ Unique points: ${points.length}`);
console.log(`Saved JSON -> ${outJson}`);
console.log(`Saved CSV  -> ${outCsv}`);
