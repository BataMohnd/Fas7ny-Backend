const express = require('express');
const router = express.Router();
const tripController = require('../../controllers/tripController');

/**
 * 🗺️ Trip Itinerary Routes
 * Base Path: /api/v2/trips
 */

// Handle search and AI itinerary generation
router.get('/search', tripController.searchTrips);

// ── NEW: Dynamic Trip Planner (Node.js/MongoDB logic) ──
router.post('/generate', tripController.generateTripPlan);

module.exports = router;

/*
// 🧪 LEGACY TEST LOGIC (Use as standalone script for API debugging)
require('dotenv').config();
const axios = require('axios');

async function testDirect() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    try {
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: "Say hello!" }] }]
        });
        console.log("✅ Success! AI Responded:", response.data.candidates[0].content.parts[0].text);
    } catch (err) {
        console.error("❌ REST API Error:", err.response ? err.response.data.error : err.message);
    }
}
// testDirect();
*/