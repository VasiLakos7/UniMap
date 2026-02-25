"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const campus_graph_1 = require("../services/campus-graph");
const router = (0, express_1.Router)();
/**
 * POST /api/route/campus
 * Body: { fromLat, fromLng, destinationName?, destLat?, destLng?, wheelchair? }
 *
 * Η app στέλνει το όνομα τμήματος (π.χ. "Τμήμα Μαιευτικής").
 * Αν δεν βρεθεί με όνομα, χρησιμοποιεί τις συντεταγμένες destLat/destLng.
 */
router.post('/', (req, res) => {
    const { fromLat, fromLng, destinationName, destLat, destLng, wheelchair } = req.body;
    if (fromLat == null || fromLng == null) {
        res.status(400).json({ error: 'Απαιτούνται: fromLat, fromLng' });
        return;
    }
    const opts = { wheelchair: !!wheelchair };
    // 1. Βρες το end node: πρώτα με όνομα, μετά με συντεταγμένες
    let endNodeId = null;
    if (destinationName) {
        endNodeId = (0, campus_graph_1.getNodeIdForName)(destinationName);
    }
    if (!endNodeId && destLat != null && destLng != null) {
        endNodeId = (0, campus_graph_1.findNearestNodeId)(destLat, destLng, opts);
    }
    if (!endNodeId) {
        res.status(404).json({ error: 'Δεν βρέθηκε node για τον προορισμό.' });
        return;
    }
    // 2. Βρες το καλύτερο σημείο εκκίνησης
    const startNodeId = (0, campus_graph_1.findBestStartNode)(fromLat, fromLng, endNodeId, opts);
    if (!startNodeId) {
        res.status(422).json({ error: 'Δεν βρέθηκε κοντινό node στη θέση σου. Βρίσκεσαι εντός campus;' });
        return;
    }
    // 3. Υπολόγισε διαδρομή
    const result = (0, campus_graph_1.calculatePathWithLength)(startNodeId, endNodeId, opts);
    if (!result) {
        res.status(422).json({ error: 'Δεν βρέθηκε διαδρομή προς τον προορισμό.' });
        return;
    }
    res.json(result);
});
exports.default = router;
