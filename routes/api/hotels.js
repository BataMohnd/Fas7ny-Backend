const express = require('express');
const router = express.Router();
const placeController = require('../../controllers/placeController');

router.get('/', (req, res, next) => {
    console.log(`📱 Received Hotel Request from IP: ${req.ip} | URL: ${req.originalUrl}`);
    next();
}, placeController.getHotels);

module.exports = router;