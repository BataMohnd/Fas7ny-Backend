const express = require('express');
const router = express.Router();
const placeController = require('../controllers/placeController');
const { getGooglePlacePhoto, getFallbackImage } = require('../utils/photoEnricher');

router.get('/search', placeController.searchPlaces);
router.get('/all', placeController.getAllPlaces);
router.get('/hotels', placeController.getHotels);
router.get('/hotels/city', placeController.getHotelsByCity);
router.get('/hotels/:hotelId', placeController.getHotelDetails);
router.get('/attractions/availability', placeController.getAttractionAvailability);
router.post('/calculate-price', placeController.calculateBookingPrice);
router.get('/nearby', placeController.getNearbyPlaces);
router.get('/nearby-places', placeController.getNearbyPlaces); // Alias for discovery
router.get('/nearby-hotels', placeController.getNearbyHotels);

// GET /api/places/photo?name=...&city=...&category=...
// Flutter SmartPlaceImage calls this to get a real photo URL for a named place.
router.get('/photo', async (req, res) => {
    const { name, city = '', category = 'hotel' } = req.query;

    if (!name) {
        return res.status(400).json({ success: false, message: 'name query parameter is required' });
    }

    try {
        let photoUrl = await getGooglePlacePhoto(name, city, category);
        const source = photoUrl ? 'google_places' : 'fallback';

        if (!photoUrl) {
            photoUrl = getFallbackImage(category);
        }

        return res.status(200).json({ success: true, photoUrl, source });
    } catch (err) {
        console.error('[/places/photo] Error:', err.message);
        return res.status(500).json({
            success: false,
            photoUrl: getFallbackImage(category),
            source: 'fallback',
        });
    }
});

module.exports = router;