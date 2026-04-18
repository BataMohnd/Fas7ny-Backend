const express = require('express');
const router = express.Router();
const placeController = require('../controllers/placeController');

router.get('/search', placeController.searchPlaces);
router.get('/all', placeController.getAllPlaces);
router.get('/hotels', placeController.getHotels);
router.get('/hotels/:hotelId', placeController.getHotelDetails);
router.get('/attractions/availability', placeController.getAttractionAvailability);
router.post('/calculate-price', placeController.calculateBookingPrice);
router.get('/nearby', placeController.getNearbyAttractions);

module.exports = router;