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
    setEdgeTag('M_DOWN_1', 'M_BOTTOM_MID', 'RAMP');
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
    setEdgeTag('N0134', 'N0150', 'STAIRS');
    setEdgeTag('N0070', 'N0153', 'RAMP');
    setEdgeTag('M_53_109_1', 'M_TOP1_TO_53_1', 'RAMP');
    setEdgeTag('N0053', 'N0042', 'RAMP');
    setEdgeTag('M_CENTRAL', 'M_CENT_PRE_1', 'STAIRS');
    setEdgeTag('M_68_TO_BOTTOM_1', 'M_TROFIMON_APPROACH', 'RAMP');
    setEdgeTag('N0160', 'N0149', 'RAMP');
    setEdgeTag('N0021', 'M_TOP_6', 'RAMP');
    setEdgeTag('N0033', 'M_61_TO_31_1', 'RAMP');
    setEdgeTag('N0160', 'N0157', 'STAIRS');
    setEdgeTag('N0069', 'N0129', 'STAIRS');
    setEdgeTag('N0045', 'N0108', 'STAIRS');
    setEdgeTag('N0038', 'M_HOSPITAL_APPROACH', 'RAMP');
    setEdgeTag('M_TOP1_TO_75_1', 'N0071', 'RAMP');
}
