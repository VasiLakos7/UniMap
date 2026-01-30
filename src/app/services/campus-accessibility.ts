export type EdgeTag = 'ALL' | 'STAIRS' | 'RAMP';

function edgeKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const EDGE_TAGS = new Map<string, EdgeTag>();

export function setEdgeTag(a: string, b: string, tag: EdgeTag) {
  EDGE_TAGS.set(edgeKey(a, b), tag);
}

export function getEdgeTag(a: string, b: string): EdgeTag {
  return EDGE_TAGS.get(edgeKey(a, b)) ?? 'ALL';
}

export function edgeAllowedForWheelchair(tag: EdgeTag): boolean {
  return tag !== 'STAIRS';
}

export function registerAccessibilityEdges() {

  //test
  setEdgeTag('M_DOWN_1', 'M_CENTRAL_TO_DOWN_1', 'STAIRS');
  setEdgeTag('M_DOWN_1', 'M_BOTTOM_MID', 'STAIRS');
  
}
