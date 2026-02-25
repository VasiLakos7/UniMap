"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setEdgeTag = setEdgeTag;
exports.getEdgeTag = getEdgeTag;
exports.edgeAllowedForWheelchair = edgeAllowedForWheelchair;
exports.registerAccessibilityEdges = registerAccessibilityEdges;
function edgeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}
const EDGE_TAGS = new Map();
function setEdgeTag(a, b, tag) {
    EDGE_TAGS.set(edgeKey(a, b), tag);
}
function getEdgeTag(a, b) {
    return EDGE_TAGS.get(edgeKey(a, b)) ?? 'ALL';
}
function edgeAllowedForWheelchair(tag) {
    return tag !== 'STAIRS';
}
function registerAccessibilityEdges() {
    setEdgeTag('M_DOWN_1', 'M_CENTRAL_TO_DOWN_1', 'STAIRS');
    setEdgeTag('M_DOWN_1', 'M_BOTTOM_MID', 'STAIRS');
}
