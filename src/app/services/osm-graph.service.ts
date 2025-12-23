import { Injectable } from '@angular/core';
import * as L from 'leaflet';
import { nodeCoords, campusGraphData } from './osm/campus-osm-graph';
import type { Destination } from '../models/destination.model';

type Graph = Record<string, Record<string, number>>;

@Injectable({ providedIn: 'root' })
export class OsmGraphService {
  private graph: Graph = campusGraphData as unknown as Graph;

  private nodeToComp = new Map<string, number>();
  private compSizes = new Map<number, number>();
  private nodesByComp = new Map<number, string[]>();

  constructor() {
    this.buildComponents();
  }

  // -----------------------
  // Existing helpers
  // -----------------------
  getDestinationCoords(id: string): L.LatLng | null {
    return ((nodeCoords as any)[id] as L.LatLng) ?? null;
  }

  getComponentId(id: string): number | null {
    return this.nodeToComp.get(id) ?? null;
  }

  findNearestNodeId(lat: number, lng: number, componentId?: number | null): string | null {
    const target = L.latLng(lat, lng);
    let bestId: string | null = null;
    let best = Infinity;

    for (const id of Object.keys(nodeCoords)) {
      if (componentId != null) {
        const c = this.nodeToComp.get(id);
        if (c !== componentId) continue;
      }
      const p = (nodeCoords as any)[id] as L.LatLng;
      const d = target.distanceTo(p);
      if (d < best) { best = d; bestId = id; }
    }
    return bestId;
  }

  calculatePath(startId: string, endId: string): L.LatLng[] {
    // (όπως το έχεις ήδη)
    if (startId === endId) {
      const p = this.getDestinationCoords(startId);
      return p ? [p] : [];
    }
    if (!this.graph[startId] || !this.graph[endId]) return [];

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const k of Object.keys(this.graph)) {
      dist.set(k, Infinity);
      prev.set(k, null);
    }
    dist.set(startId, 0);

    while (true) {
      let u: string | null = null;
      let best = Infinity;

      for (const [k, v] of dist.entries()) {
        if (visited.has(k)) continue;
        if (v < best) { best = v; u = k; }
      }

      if (!u) break;
      if (u === endId) break;

      visited.add(u);

      const neighbors = this.graph[u] || {};
      for (const v of Object.keys(neighbors)) {
        if (visited.has(v)) continue;
        const w = neighbors[v] ?? 1;
        const alt = (dist.get(u) ?? Infinity) + w;

        if (alt < (dist.get(v) ?? Infinity)) {
          dist.set(v, alt);
          prev.set(v, u);
        }
      }
    }

    // rebuild
    const nodePath: string[] = [];
    let cur: string | null = endId;

    if ((prev.get(cur) ?? null) === null && cur !== startId) return [];

    while (cur) {
      nodePath.push(cur);
      if (cur === startId) break;
      cur = prev.get(cur) ?? null;
    }
    nodePath.reverse();

    const out: L.LatLng[] = [];
    for (const id of nodePath) {
      const p = this.getDestinationCoords(id);
      if (p) out.push(p);
    }
    return out;
  }

  // -----------------------
  // ✅ NEW: Largest component
  // -----------------------
  getLargestComponentId(): number | null {
    let bestComp: number | null = null;
    let bestSize = -1;
    for (const [cid, sz] of this.compSizes.entries()) {
      if (sz > bestSize) { bestSize = sz; bestComp = cid; }
    }
    return bestComp;
  }

  // -----------------------
  // ✅ NEW: Debug which departments are “off network”
  // -----------------------
  debugDestinationsCoverage(destinations: Destination[]) {
    const main = this.getLargestComponentId();
    if (main == null) {
      console.warn('No components found');
      return;
    }

    const rows = destinations.map(d => {
      const lat = d.entranceLat ?? d.lat;
      const lng = d.entranceLng ?? d.lng;

      const nearestAny = this.findNearestNodeId(lat, lng);
      if (!nearestAny) {
        return { name: d.name, status: 'NO_NODE', nearest: null, comp: null, dist_m: null };
      }

      const p = this.getDestinationCoords(nearestAny)!;
      const distM = Math.round(L.latLng(lat, lng).distanceTo(p));
      const comp = this.getComponentId(nearestAny);
      const status = (comp === main) ? 'OK' : 'OFF_COMPONENT';

      return { name: d.name, status, nearest: nearestAny, comp, dist_m: distM };
    });

    console.log('--- Destination coverage (OK vs OFF_COMPONENT) ---');
    // ωραίο output
    // @ts-ignore
    console.table(rows);

    const off = rows.filter(r => r.status !== 'OK');
    console.log(`OFF_COMPONENT count = ${off.length}`);
  }

  // -----------------------
  // ✅ NEW: Suggest “bridge edges” to connect components
  // -----------------------
  suggestBridgeEdges(maxMeters = 35) {
    const main = this.getLargestComponentId();
    if (main == null) return [];

    const mainNodes = this.nodesByComp.get(main) ?? [];
    const suggestions: Array<{ from: string; to: string; dist_m: number; fromComp: number; toComp: number }> = [];

    for (const [cid, nodes] of this.nodesByComp.entries()) {
      if (cid === main) continue;

      let best = { from: '', to: '', dist: Infinity };

      for (const a of nodes) {
        const pa = this.getDestinationCoords(a);
        if (!pa) continue;

        for (const b of mainNodes) {
          const pb = this.getDestinationCoords(b);
          if (!pb) continue;

          const d = pa.distanceTo(pb);
          if (d < best.dist) best = { from: a, to: b, dist: d };
        }
      }

      if (best.from && best.to) {
        suggestions.push({
          from: best.from,
          to: best.to,
          dist_m: Math.round(best.dist),
          fromComp: cid,
          toComp: main,
        });
      }
    }

    suggestions.sort((x, y) => x.dist_m - y.dist_m);

    console.log('--- Suggested bridge edges (closest per component) ---');
    // @ts-ignore
    console.table(suggestions);

    const good = suggestions.filter(s => s.dist_m <= maxMeters);
    console.log(`Bridges within ${maxMeters}m: ${good.length}`);
    console.log('Add these (recommended):', good.map(g => [g.from, g.to]));

    return suggestions;
  }

  // -----------------------
  // components build
  // -----------------------
  private buildComponents() {
    const nodes = Object.keys(nodeCoords);
    let compId = 0;

    this.nodeToComp.clear();
    this.compSizes.clear();
    this.nodesByComp.clear();

    for (const start of nodes) {
      if (this.nodeToComp.has(start)) continue;

      const q: string[] = [start];
      this.nodeToComp.set(start, compId);

      const compNodes: string[] = [start];

      while (q.length) {
        const u = q.shift()!;
        const neigh = this.graph[u] ? Object.keys(this.graph[u]) : [];
        for (const v of neigh) {
          if (this.nodeToComp.has(v)) continue;
          this.nodeToComp.set(v, compId);
          compNodes.push(v);
          q.push(v);
        }
      }

      this.compSizes.set(compId, compNodes.length);
      this.nodesByComp.set(compId, compNodes);

      compId++;
    }
  }
}
