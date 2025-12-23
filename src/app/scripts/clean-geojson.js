const fs = require("fs");

const input = process.argv[2] || "campus.geojson";
const output = process.argv[3] || "campus_clean.geojson";

const DENY = new Set([
  372296658, 372296649, 372296648, 372296644, 372296655, 372296660, 372296647,
  201790965, 1170500943, 1170500945, 1324733742, 1324733743, 372296643, 372296662,
  372296674, 372296652, 372296675, 372296670, 639599158, 1049721072, 372296646,
  1049721070, 1049721071, 372296665, 372296651
]);

function toWayId(val) {
  if (val == null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    let s = val.trim();
    if (s.startsWith("way/")) s = s.split("/", 2)[1];
    if (/^\d+$/.test(s)) return Number(s);
  }
  return null;
}

const data = JSON.parse(fs.readFileSync(input, "utf8"));

const feats = Array.isArray(data.features) ? data.features : [];
const kept = [];
let removedCount = 0;

for (const feat of feats) {
  const props = feat.properties || {};
  const wid = toWayId(props["@id"]) || toWayId(feat.id);
  if (wid && DENY.has(wid)) {
    removedCount++;
  } else {
    kept.push(feat);
  }
}

data.features = kept;

fs.writeFileSync(output, JSON.stringify(data, null, 2), "utf8");

console.log(`OK ✅ Removed: ${removedCount} | Kept: ${kept.length}`);
console.log(`Saved -> ${output}`);
