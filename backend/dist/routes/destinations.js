"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const destinations_1 = require("../data/destinations");
const router = (0, express_1.Router)();
// GET /api/destinations
router.get('/', (_req, res) => {
    res.json(destinations_1.destinationList);
});
// GET /api/destinations/:id
router.get('/:id', (req, res) => {
    const dest = destinations_1.destinationList.find((d) => d.id === req.params['id']);
    if (!dest) {
        res.status(404).json({ error: 'Destination not found' });
        return;
    }
    res.json(dest);
});
exports.default = router;
