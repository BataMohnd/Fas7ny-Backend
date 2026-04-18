const express = require('express');
const router = express.Router();
const aiController = require('../../controllers/aiSearchController');

router.post('/smart-search', aiController.smartSearch);
router.post('/compare-rank', aiController.compareAndRank);
router.get('/proactive-suggestions', aiController.proactiveSuggestions);

module.exports = router;