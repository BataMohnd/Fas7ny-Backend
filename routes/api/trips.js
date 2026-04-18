const express = require('express');
const router = express.Router();
const tripController = require('../../controllers/tripController');

// GET /api/v2/trips/search
router.get('/search', tripController.searchTrips);

module.exports = router;
