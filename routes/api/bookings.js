const express = require('express');
const router = express.Router();
const bookingController = require('../../controllers/bookingController');

// ─── Booking Actions ────────────────────────────────────────────────────────
router.post('/create', bookingController.createBooking);
router.get('/user/:userId', bookingController.getUserBookings);
router.get('/next/:userId', bookingController.getNextTrip);
router.patch('/:bookingId/cancel', bookingController.cancelBooking);

module.exports = router;
