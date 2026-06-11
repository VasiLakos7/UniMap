import { EdgeTag } from '../types';

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const EDGE_TAGS = new Map<string, EdgeTag>();

export function setEdgeTag(a: string, b: string, tag: EdgeTag): void {
  EDGE_TAGS.set(edgeKey(a, b), tag);
}

export function getEdgeTag(a: string, b: string): EdgeTag {
  return EDGE_TAGS.get(edgeKey(a, b)) ?? 'ALL';
}

export function edgeAllowedForWheelchair(tag: EdgeTag): boolean {
  return tag !== 'STAIRS';
}

export function registerAccessibilityEdges(): void {
  setEdgeTag('M_DOWN_1', 'M_CENTRAL_TO_DOWN_1', 'STAIRS');
  setEdgeTag('M_DOWN_1', 'M_BOTTOM_MID', 'STAIRS');
  setEdgeTag('M_HOSPITAL_APPROACH', 'N0154', 'STAIRS');
  setEdgeTag('N0129', 'N0130', 'STAIRS');
  setEdgeTag('N0130', 'N0131', 'STAIRS');
  setEdgeTag('N0131', 'N0132', 'STAIRS');
  setEdgeTag('N0132', 'N0095', 'STAIRS');
  setEdgeTag('N0095', 'N0126', 'STAIRS');
  setEdgeTag('N0126', 'N0127', 'STAIRS');
  setEdgeTag('N0150', 'N0135', 'STAIRS');
  setEdgeTag('N0135', 'N0136', 'STAIRS');
  setEdgeTag('N0136', 'N0137', 'STAIRS');
  setEdgeTag('N0137', 'N0138', 'STAIRS');
  setEdgeTag('N0138', 'N0139', 'STAIRS');
  setEdgeTag('N0145', 'N0108', 'STAIRS');
  setEdgeTag('N0126', 'N0107', 'STAIRS');
  setEdgeTag('N0107', 'N0108', 'STAIRS');
  setEdgeTag('N0109', 'N0052', 'STAIRS');
  setEdgeTag('N0109', 'M_79_109_1', 'STAIRS');
  setEdgeTag('M_79_109_1', 'N0079', 'STAIRS');
  setEdgeTag('N0079', 'N0097', 'STAIRS');
  setEdgeTag('N0097', 'N0098', 'STAIRS');
  setEdgeTag('N0098', 'N0099', 'STAIRS');
  setEdgeTag('N0099', 'N0100', 'STAIRS');
  setEdgeTag('N0100', 'N0101', 'STAIRS');
  setEdgeTag('N0101', 'N0102', 'STAIRS');
  setEdgeTag('N0102', 'N0103', 'STAIRS');
  setEdgeTag('N0103', 'N0104', 'STAIRS');
  setEdgeTag('N0104', 'N0105', 'STAIRS');
  setEdgeTag('N0105', 'N0106', 'STAIRS');
  setEdgeTag('N0079', 'N0078', 'STAIRS');
  setEdgeTag('N0146', 'N0071', 'STAIRS');
}
