import * as L from 'leaflet';

export function angleDiffDeg(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

export function applyMaxStep(prev: number, next: number, maxStep: number): number {
  const d = angleDiffDeg(prev, next);
  if (Math.abs(d) <= maxStep) return next;
  const limited = prev + Math.sign(d) * maxStep;
  return (limited + 360) % 360;
}

export function smoothAngle(prev: number | null, next: number, alpha = 0.25): number {
  if (prev == null) return next;
  const diff = angleDiffDeg(prev, next);
  return (prev + diff * alpha + 360) % 360;
}

export function bearingDeg(from: L.LatLng, to: L.LatLng): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  const brng = Math.atan2(y, x);
  const deg = (brng * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function sumDistanceMeters(points: L.LatLng[]): number {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i - 1].distanceTo(points[i]);
  return total;
}
