const express = require('express');
const router = express.Router();
const entertainmentController = require('../controllers/entertainmentController');

router.get('/explore', entertainmentController.exploreEntertainment);

module.exports = router;
