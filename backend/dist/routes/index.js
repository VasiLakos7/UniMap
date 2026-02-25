"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const destinations_1 = __importDefault(require("./destinations"));
const campus_1 = __importDefault(require("./campus"));
const outdoor_1 = __importDefault(require("./outdoor"));
const router = (0, express_1.Router)();
router.use('/destinations', destinations_1.default);
router.use('/route/campus', campus_1.default);
router.use('/route/outdoor', outdoor_1.default);
exports.default = router;
