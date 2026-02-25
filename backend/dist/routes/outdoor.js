"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const node_fetch_1 = __importDefault(require("node-fetch"));
const router = (0, express_1.Router)();
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot';
/**
 * GET /api/route/outdoor?fromLat=&fromLng=&toLat=&toLng=
 * Proxy για το OSRM API — επιστρέφει GeoJSON route geometry
 */
router.get('/', async (req, res) => {
    const { fromLat, fromLng, toLat, toLng } = req.query;
    if (!fromLat || !fromLng || !toLat || !toLng) {
        res.status(400).json({ error: 'Απαιτούνται: fromLat, fromLng, toLat, toLng' });
        return;
    }
    const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=false`;
    try {
        const upstream = await (0, node_fetch_1.default)(url);
        if (!upstream.ok) {
            res.status(502).json({ error: 'OSRM error', status: upstream.status });
            return;
        }
        const data = await upstream.json();
        if (!data?.routes?.length) {
            res.status(404).json({ error: 'OSRM: δεν βρέθηκε διαδρομή' });
            return;
        }
        // Επιστρέφουμε lat/lng array (ίδια μορφή με campus route)
        const coords = data.routes[0].geometry.coordinates;
        const path = coords.map(([lng, lat]) => ({ lat, lng }));
        res.json({ path });
    }
    catch (err) {
        console.error('[outdoor route] Σφάλμα OSRM:', err);
        res.status(503).json({ error: 'Αδύνατη σύνδεση με OSRM' });
    }
});
exports.default = router;
