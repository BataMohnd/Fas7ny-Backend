const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/userPlaceController');

// ── Order matters: specific paths before parameterised ────────────────────
router.get('/all',                            ctrl.getAllPlaces);         // Browse approved places
router.get('/my/:ownerId',                    ctrl.getMyPlaces);          // Owner's own submissions
router.get('/:placeId/bookings',              ctrl.getPlaceBookings);     // Bookings for a place
router.post('/add',                           ctrl.addPlace);             // Submit a new place
router.patch('/bookings/:bookingId/status',   ctrl.updateBookingStatus);  // Accept / reject booking
router.patch('/:id/status',                   ctrl.updateStatus);         // Admin approve / reject
router.delete('/:id',                         ctrl.deletePlace);          // Owner deletes their place

module.exports = router;
