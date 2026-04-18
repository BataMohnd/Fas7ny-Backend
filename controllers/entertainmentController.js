const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const Place = require("../models/Place"); // Assume Place.js exports the Mongoose model
const User = require("../models/User");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });

exports.exploreEntertainment = async (req, res) => {
    try {
        const { cityId, lat, lng, userId } = req.query;

        // Coordinate Logic: Ensure lat/lng are parsed gracefully
        let numericLat = parseFloat(lat);
        let numericLng = parseFloat(lng);
        let cityContext = "Cairo"; // Default

        // Apply Hybrid Logic: if lat/lng are invalid, use default mappings based on cityId
        if (isNaN(numericLat) || isNaN(numericLng)) {
            let cityMap = {
                '-3712125': { name: "Cairo", lat: 30.0444, lng: 31.2357 },
                '8': { name: "Dubai", lat: 25.2048, lng: 55.2708 },
                '-3712078': { name: "Alexandria", lat: 31.2001, lng: 29.9187 },
                '-3712073': { name: "Hurghada", lat: 27.2579, lng: 33.8116 },
                '-3712071': { name: "Luxor", lat: 25.6872, lng: 32.6396 },
                '-3712055': { name: "Sharm El-Sheikh", lat: 27.9158, lng: 34.3299 }
            };
            let mapped = cityMap[cityId] || cityMap['-3712125'];
            numericLat = mapped.lat;
            numericLng = mapped.lng;
            cityContext = mapped.name;
        } else {
            // Find city context if possible
            let cityMap = {
                '-3712125': "Cairo", '8': "Dubai", '-3712078': "Alexandria",
                '-3712073': "Hurghada", '-3712071': "Luxor", '-3712055': "Sharm El-Sheikh"
            };
            cityContext = cityMap[cityId] || "Cairo";
        }

        console.log(`\n🎟️ Exploring Entertainment in ${cityContext} | NN Center [${numericLat}, ${numericLng}]`);

        // Categories mapping Context -> Query
        let queryPrompt = `top tourist attractions, activities and entertainment in ${cityContext}`;
        if (["Hurghada", "Sharm El-Sheikh", "Alexandria"].includes(cityContext)) {
            queryPrompt = `top beaches, water sports, and activities in ${cityContext}`;
        } else if (["Luxor", "Aswan"].includes(cityContext)) {
            queryPrompt = `top historic temples and Nile cruises in ${cityContext}`;
        }

        // STEP 1: $near MongoDB query (Radius 50km mostly since the city could be wide)
        let localActivities = await Place.find({
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [numericLng, numericLat] // GeoJSON is [LNG, LAT]
                    },
                    $maxDistance: 50000 // 50km
                }
            },
            category: { $in: ['attraction', 'museum', 'activity', 'entertainment', 'beach', 'cruise', 'historical'] }
        }).limit(10);

        // Calculate manual distances if needed just for the log
        let count = localActivities.length;
        if (count > 0) {
            console.log(`✅ MongoDB Cache Hit: Found ${count} activities nearby.`);
            localActivities.forEach(p => {
                let pLng = p.location?.coordinates[0] || p.longitude;
                let pLat = p.location?.coordinates[1] || p.latitude;
                // Basic Haversine approx for logging
                let dx = pLng - numericLng;
                let dy = pLat - numericLat;
                let distApprox = Math.sqrt(dx*dx + dy*dy) * 111.32; // rough km conversion
                console.log(`   📍 ${p.name.padEnd(25)} | Distance: ~${distApprox.toFixed(2)} km`);
            });
        }

        // STEP 2: Scrape Fallback if < 5 activities found
        if (count < 5 && process.env.SERPER_API_KEY) {
            console.log(`⚠️ Insufficient Activities (${count}/5). Triggering Serper API for "${queryPrompt}"`);
            
            try {
                const serperRes = await axios.post('https://google.serper.dev/places', {
                    q: queryPrompt,
                    location: `${numericLat},${numericLng}`
                }, {
                    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }
                });

                let rawPlaces = serperRes.data?.places || [];
                let newPlaces = rawPlaces.map(p => {
                    let cat = p.category ? p.category.toLowerCase() : "attraction";
                    if(cat.includes("museum") || cat.includes("history")) cat = "historical";
                    else if(cat.includes("beach") || cat.includes("sea")) cat = "beach";
                    else cat = "attraction";

                    return {
                        name: p.title || p.name || "Exciting Spot",
                        description: p.address || "",
                        price: 300, // mock base price
                        neighbourhood: cityContext,
                        imageUrl: p.imageUrl || "https://images.unsplash.com/photo-1544256241-11dcedfeb8f8",
                        category: cat,
                        rating: p.rating || 4.5,
                        numberOfReviews: p.ratingCount || Math.floor(Math.random() * 500) + 50,
                        latitude: p.latitude || numericLat,
                        longitude: p.longitude || numericLng,
                        location: {
                            type: "Point",
                            coordinates: [p.longitude || numericLng, p.latitude || numericLat]
                        }
                    };
                });

                if (newPlaces.length > 0) {
                    try {
                        const inserted = await Place.insertMany(newPlaces, { ordered: false });
                        localActivities.push(...inserted);
                        console.log(`✅ Serper Success: Synced ${newPlaces.length} real locations into MongoDB.`);
                    } catch (err) {
                       console.warn("DB Insert Warn:", err.message);
                    }
                }
            } catch (e) {
                if (e.response && e.response.status === 403) {
                    console.error(`⚠️ Check Serper Key: Forbidden (403). Using Multi-City Fallback for ${cityContext}.`);
                    
                    let fallbackSpots = [];
                    if (cityContext === "Alexandria") {
                        fallbackSpots = [
                            { name: "Bibliotheca Alexandrina", description: "A major library and cultural center on the shore of the Mediterranean.", lat: 31.2089, lng: 29.9092, cat: "historical", img: "https://images.unsplash.com/photo-1568292342316-60aa3d36f4b3" },
                            { name: "Citadel of Qaitbay", description: "A 15th-century defensive fortress on the Mediterranean coast.", lat: 31.2140, lng: 29.8850, cat: "historical", img: "https://images.unsplash.com/photo-1599833454130-19277d70054a" },
                            { name: "Stanly Bridge", description: "An iconic bridge offering stunning views of the Mediterranean Sea.", lat: 31.2355, lng: 29.9480, cat: "entertainment", img: "https://images.unsplash.com/photo-1568292342316-60aa3d36f4b3" },
                            { name: "Montaza Palace", description: "Lush gardens and palaces overlooking the sea.", lat: 31.2872, lng: 30.0161, cat: "attraction", img: "https://images.unsplash.com/photo-1599833454130-19277d70054a" }
                        ];
                    } else {
                        // Default to Cairo Fallback
                        fallbackSpots = [
                            { name: "The Egyptian Museum", description: "Home to the largest collection of ancient Egyptian relics.", lat: 30.0478, lng: 31.2336, cat: "historical", img: "https://images.unsplash.com/photo-1572252009286-268acec5ca0a" },
                            { name: "Khan el-Khalili", description: "A famous bazaar and souq in the historic center of Cairo.", lat: 30.0477, lng: 31.2622, cat: "entertainment", img: "https://images.unsplash.com/photo-1544971587-b842c27f8e14" },
                            { name: "Al-Azhar Park", description: "Lush gardens with panoramic views of Cairo's skyline.", lat: 30.0406, lng: 31.2652, cat: "attraction", img: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb" },
                            { name: "Cairo Tower", description: "Iconic tower offering 360-degree views of the city.", lat: 30.0459, lng: 31.2243, cat: "entertainment", img: "https://images.unsplash.com/photo-1544256241-11dcedfeb8f8" }
                        ];
                    }
                    
                    const dynamicFallback = fallbackSpots.map(s => ({
                        name: s.name, description: s.description, price: 300, neighbourhood: cityContext,
                        imageUrl: s.img, category: s.cat, rating: 4.8, numberOfReviews: 1200,
                        latitude: s.lat, longitude: s.lng,
                        location: { type: "Point", coordinates: [s.lng, s.lat] }
                    }));
                    localActivities.push(...dynamicFallback);
                } else {
                    console.warn(`Serper fallback failed: ${e.message}`);
                }
            }
        }

        // Ensure we filter out duplicates if we concatenated array, but usually reloading from DB is safer.
        // For speed, since this is a demo, we'll just remove duplicates by name locally.
        const uniqueActivitiesMap = new Map();
        localActivities.forEach(act => uniqueActivitiesMap.set(act.name, act));
        const finalActivities = Array.from(uniqueActivitiesMap.values()).slice(0, 15);

        // STEP 3: Gemini Insight
        let insight = "Explore top attractions around you and dive into unforgettable local adventures!";
        if (finalActivities.length > 0) {
            let topSpot = finalActivities[0].name;
            try {
                let userInterests = "travel";
                if (userId) {
                    const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] });
                    if (user && user.preferences?.length > 0) userInterests = user.preferences.join(", ");
                }

                const prompt = `Write a punchy, conversational travel tip in exactly 1-2 short sentences (max 20 words).
User interests: ${userInterests}. Top activity nearby: "${topSpot}".
Example format: "Since you love History, ${topSpot} is only a few minutes away!"`;

                const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
                insight = result.response.text().trim().replace(/"/g, ''); // remove extra quotes
            } catch (e) {
                console.warn("Gemini Insight failed:", e.message);
                insight = `Since you're nearby, ${topSpot} is highly recommended to check out today!`;
            }
        }

        return res.status(200).json({
            success: true,
            insight: insight,
            data: finalActivities
        });

    } catch (error) {
        console.error("🔥 Entertainment Explore Error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch activities" });
    }
};
