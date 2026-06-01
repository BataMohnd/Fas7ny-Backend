const express = require('express');
const router = express.Router();
const ratingController = require('../../controllers/ratingController');

router.post('/', ratingController.createRating);
router.get('/:placeId', ratingController.getPlaceRatings);
router.get('/summary/:placeId', ratingController.getRatingSummary);

module.exports = router;
