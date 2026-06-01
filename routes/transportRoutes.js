const express = require('express');
const router  = express.Router();
const transport = require('../controllers/transportController');

// GET /api/transport/options?from=cairo&to=luxor&date=2025-08-01&adults=2&style=family&budget=5000
router.get('/options',  transport.getTransportOptions);

// GET /api/transport/search?origin=القاهرة&destination=الغردقة&type=all
// Mobile-friendly — always returns JSON, never 500
router.get('/search',   transport.searchTransport);

// POST /api/transport/smart  — body: { from, to, date, adults, travelStyle, budget, userId }
router.post('/smart',   transport.getSmartTransport);

// GET /api/transport/flights?from=cairo&to=luxor&date=2025-08-01&adults=1
router.get('/flights',  transport.getFlights);

// GET /api/transport/trains?from=cairo&to=luxor&adults=2
router.get('/trains',   transport.getTrains);

// GET /api/transport/buses?from=cairo&to=hurghada&adults=2
router.get('/buses',    transport.getBuses);

module.exports = router;
