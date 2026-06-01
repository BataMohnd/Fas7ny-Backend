const axios = require("axios");
const Place = require("../models/Place"); // Assume Place.js exports the Mongoose model
const User = require("../models/User");
const { callGemini } = require('../utils/geminiClient');

// ── TSP Heuristic: Nearest Neighbor ───────────────────────────────────────────
function optimizeRoute(startNode, locations) {
    let unvisited = [...locations];
    let current = startNode;
    let route = [];

    while (unvisited.length > 0) {
        let closestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            let loc = unvisited[i];
            let dLng = (loc.location?.coordinates[0] || loc.longitude) - current.lng;
            let dLat = (loc.location?.coordinates[1] || loc.latitude) - current.lat;
            let dist = Math.sqrt(dLng * dLng + dLat * dLat);

            if (dist < minDistance) {
                minDistance = dist;
                closestIndex = i;
            }
        }
        
        let winner = unvisited.splice(closestIndex, 1)[0];
        route.push(winner);
        current = { 
            lat: winner.location?.coordinates[1] || winner.latitude, 
            lng: winner.location?.coordinates[0] || winner.longitude 
        };
    }
    return route;
}

/**
 * 📍 Ground Truth Coordinate Resolver
 * Standardizes demo cities to prevent external geocoding failures.
 */
function getCityCoordinates(cityId) {
    const cityMap = {
        '-3712125': { name: "Cairo", lat: 30.0444, lng: 31.2357 },
        '8': { name: "Dubai", lat: 25.2048, lng: 55.2708 },
        '-3712078': { name: "Alexandria", lat: 31.2001, lng: 29.9187 },
        '-3712073': { name: "Hurghada", lat: 27.2579, lng: 33.8116 },
        '-3712071': { name: "Luxor", lat: 25.6872, lng: 32.6396 },
        '-3712055': { name: "Sharm El-Sheikh", lat: 27.9158, lng: 34.3299 }
    };
    return cityMap[cityId];
}

exports.exploreEntertainment = async (req, res) => {
    try {
        const { cityId, lat, lng, userId, bookingId } = req.query;

        // 1. Coordinate Resolution Logic via Ground Truth Resolver
        let numericLat = parseFloat(lat);
        let numericLng = parseFloat(lng);
        let cityContext = "Cairo";

        const verified = getCityCoordinates(cityId);
        if (verified) {
            // Force verified coordinates for demo-safety unless valid lat/lng provided (Ground Truth takes precedence for demo stability)
            if (isNaN(numericLat) || isNaN(numericLng)) {
                numericLat = verified.lat;
                numericLng = verified.lng;
                console.log(`📍 NN Logic: Using Verified Demo Coordinates for ${verified.name} [${numericLat}, ${numericLng}]`);
            }
            cityContext = verified.name;
        }

        const isBrowsing = !bookingId || bookingId === 'null';
        const searchRadius = isBrowsing ? 5000 : 50000; 

        console.log(`\n🎟️ Exploring Entertainment | Context: ${cityContext} | Radius: ${searchRadius}m`);

        let queryPrompt = `top tourist attractions and entertainment in ${cityContext}`;

        // STEP 1: $near MongoDB query
        const dbQuery = {
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [numericLng, numericLat]
                    },
                    $maxDistance: searchRadius
                }
            },
            category: { $in: ['attraction', 'museum', 'activity', 'entertainment', 'beach', 'cruise', 'historical'] }
        };
        
        let localActivities = await Place.find(dbQuery).limit(10);
        console.log(`🔍 [MongoDB Engine] Fetched ${localActivities.length} activities for proximity analysis.`);

        // STEP 2: External Provider (Serper) Fetch if MongoDB is empty
        if (localActivities.length < 5 && process.env.SERPER_API_KEY) {
            try {
                const serperUrl = 'https://google.serper.dev/places';
                console.log(`📡 [Serper API] Requesting live data: POST ${serperUrl} | Query: "${queryPrompt}"`);
                
                const serperRes = await axios.post(serperUrl, {
                    q: queryPrompt,
                    location: `${numericLat},${numericLng}`
                }, {
                    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
                    timeout: 8000
                });

                console.log(`✅ [Serper API] Response: ${serperRes.status} OK`);

                let rawPlaces = serperRes.data?.places || [];
                let newPlaces = rawPlaces.map(p => ({
                    name: p.title || p.name || "Exciting Spot",
                    description: p.address || "",
                    price: 300,
                    neighbourhood: cityContext,
                    imageUrl: p.imageUrl || "https://images.unsplash.com/photo-1544256241-11dcedfeb8f8",
                    category: "attraction",
                    rating: p.rating || 4.5,
                    numberOfReviews: p.ratingCount || 100,
                    latitude: p.latitude || numericLat,
                    longitude: p.longitude || numericLng,
                    location: {
                        type: "Point",
                        coordinates: [p.longitude || numericLng, p.latitude || numericLat]
                    }
                }));

                if (newPlaces.length > 0) {
                    try {
                        const inserted = await Place.insertMany(newPlaces, { ordered: false });
                        localActivities.push(...inserted);
                    } catch (err) { console.warn("DB Cache Insert Warn:", err.message); }
                }
            } catch (e) { 
                const status = e.response?.status;
                console.error(`❌ [Serper API] External Provider Error: [Status ${status}] | URL: https://google.serper.dev/places`);
                if (status === 403) {
                    console.warn(`⚠️ Auth Failure (403): Triggering [${cityContext}] curated fallback layer.`);
                }
            }
        }

        // DEDUPLICATION
        const uniqueMap = new Map();
        localActivities.forEach(act => uniqueMap.set(act.name, act));
        let processedActivities = Array.from(uniqueMap.values());

        // TSP Optimization
        let optimizedActivities = optimizeRoute({ lat: numericLat, lng: numericLng }, processedActivities);

        // Curated Fallback layer if still empty or failed
        if (optimizedActivities.length === 0) {
            console.log(`⛒️  Applying Curated Hardcoded Fallback for ${cityContext}.`);
            optimizedActivities = _getCuratedActivities(cityContext);
        }

        // Gemini Insight
        let insight = `Since you're nearby, ${optimizedActivities[0]?.name || 'the area'} is highly recommended!`;
        try {
            const prompt = `Write a punchy travel tip (max 20 words) for a user near ${optimizedActivities[0]?.name}. Arabic language.`;
            const aiResult = await callGemini(prompt);
            if (aiResult.ok) insight = aiResult.text;
        } catch (e) { console.error("Insight fallback triggered."); }

        return res.status(200).json({
            success: true,
            insight: insight,
            data: optimizedActivities.slice(0, 15)
        });

    } catch (error) {
        console.error("🔥 Entertainment Explore Error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch activities" });
    }
};

/**
 * 🏗️ Curated Demo-Ready Fallbacks
 */
function _getCuratedActivities(city) {
    const c = city.toLowerCase();
    if (c.includes('cairo')) return [
        { name: 'Great Pyramids of Giza', category: 'historical', rating: 4.9, imageUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368', neighbourhood: 'Giza Plateau' },
        { name: 'Egyptian Museum', category: 'museum', rating: 4.8, imageUrl: 'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8', neighbourhood: 'Tahrir' },
        { name: 'Khan el-Khalili', category: 'attraction', rating: 4.7, imageUrl: 'https://images.unsplash.com/photo-1553913861-c0fddf2619ee', neighbourhood: 'Old Cairo' },
        { name: 'Cairo Tower', category: 'entertainment', rating: 4.6, imageUrl: 'https://images.unsplash.com/photo-1539209581898-842e47c177af', neighbourhood: 'Zamalek' }
    ];
    if (c.includes('alex')) return [
        { name: 'Bibliotheca Alexandrina', category: 'museum', rating: 4.9, imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945', neighbourhood: 'Corniche' },
        { name: 'Qaitbay Citadel', category: 'historical', rating: 4.7, imageUrl: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d', neighbourhood: 'Eastern Harbor' },
        { name: 'Stanley Bridge', category: 'attraction', rating: 4.6, imageUrl: 'https://images.unsplash.com/photo-1506461883276-594a12b11cf3', neighbourhood: 'Stanley' },
        { name: 'Montaza Palace Gardens', category: 'entertainment', rating: 4.8, imageUrl: 'https://images.unsplash.com/photo-1551221398-33318991461f', neighbourhood: 'Montaza' }
    ];
    if (c.includes('dubai')) return [
        { name: 'Burj Khalifa', category: 'entertainment', rating: 4.9, imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab', neighbourhood: 'Downtown' },
        { name: 'Dubai Mall', category: 'attraction', rating: 4.8, imageUrl: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c', neighbourhood: 'Downtown' },
        { name: 'Museum of the Future', category: 'museum', rating: 4.9, imageUrl: 'https://images.unsplash.com/photo-1582650625119-3a31f8fa26ec', neighbourhood: 'Sheikh Zayed Rd' }
    ];
    return [
        { name: 'Local Historical Tour', category: 'historical', rating: 4.5, imageUrl: 'https://via.placeholder.com/150', neighbourhood: city }
    ];
}
