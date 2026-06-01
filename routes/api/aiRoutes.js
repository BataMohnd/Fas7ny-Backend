const express = require('express');
const router = express.Router();
const aiController = require('../../controllers/aiSearchController');
const citySearchController = require('../../controllers/citySearchController');

router.post('/smart-search', aiController.smartSearch);
router.post('/compare-rank', aiController.compareAndRank);
router.get('/proactive-suggestions', aiController.proactiveSuggestions);

// ── NEW: City-Based Unified Discovery ──────────────────────────────────────
// GET  /api/ai/city-search?city=Hurghada&budget=5000
// POST /api/ai/city-search  { city: "Hurghada", budget: 5000 }
router.get('/city-search',  citySearchController.citySearch);
router.post('/city-search', citySearchController.citySearch);
router.get('/city-explorer', citySearchController.cityExplorer);

module.exports = router;