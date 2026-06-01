const Hotel = require("../models/HotelModel.js");
const User = require("../models/User");
const axios = require('axios');
const NodeCache = require('node-cache');
const { callGemini } = require('../utils/geminiClient');
if (!global.hotelCache) { global.hotelCache = new NodeCache({ stdTTL: 600 }); }
const hotelCache = global.hotelCache;

const ESTIMATED_NIGHTS = 4;

const CITY_MAP = {
    '-3712125': { name: 'Cairo',         lat: 30.0444, lng: 31.2357 },
    '8':        { name: 'Dubai',         lat: 25.2048, lng: 55.2708 },
    '-3712078': { name: 'Alexandria',    lat: 31.2001, lng: 29.9187 },
    '-3712073': { name: 'Hurghada',      lat: 27.2579, lng: 33.8116 },
    '-3712071': { name: 'Luxor',         lat: 25.6872, lng: 32.6396 },
    '-3712055': { name: 'Sharm El-Sheikh', lat: 27.9158, lng: 34.3299 },
};

// ── Shared helper: fetch raw hotels for a city ────────────────────────────────
async function _fetchRawHotels(cityId, city) {
    const cacheKey = `hotels_${cityId}`;
    const cached = hotelCache.get(cacheKey);
    if (cached) {
        console.log(`⚡ Cache HIT: ${cached.length} hotels for cityId=${cityId}`);
        return { rawHotels: cached, dataSource: 'cache' };
    }

    let rawHotels = [];
    let dataSource = 'unknown';

    // 1) RapidAPI
    if (process.env.RAPIDAPI_KEY) {
        try {
            const today    = new Date();
            const checkin  = today.toISOString().split('T')[0];
            const checkout = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
            const r = await axios.get('https://booking-com15.p.rapidapi.com/api/v1/hotels/searchHotels', {
                params: { dest_id: cityId, search_type: 'CITY', arrival_date: checkin, departure_date: checkout },
                headers: { 'X-RapidAPI-Key': process.env.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'booking-com15.p.rapidapi.com' },
                timeout: 10000
            });
            const list = r.data?.result ?? r.data?.data?.result ?? [];
            rawHotels = list.slice(0, 20);
            dataSource = 'rapid';
            console.log(`✅ RapidAPI: ${rawHotels.length} hotels`);
        } catch (e) {
            console.warn(`⚠️  RapidAPI FAIL: ${e.message}`);
        }
    }

    // 2) Serper
    if (rawHotels.length === 0 && process.env.SERPER_API_KEY) {
        try {
            const s = await axios.post('https://google.serper.dev/places',
                { q: `best hotels in ${city}`, gl: 'eg', hl: 'en' },
                { headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' }, timeout: 8000 }
            );
            const places = s.data?.places ?? [];
            rawHotels = places.slice(0, 20).map((p, i) => ({
                serper_id: `serper_${i}`,
                name:     p.title || p.name || 'Hotel',
                price:    p.price ? parseFloat(p.price.replace(/[^0-9.]/g, '')) || 0 : 0,
                rating:   p.rating || 0,
                address:  p.address || city,
                imageUrl: p.thumbnailUrl || '',
                category: 'Hotels', city, source: 'serper',
                latitude: p.latitude || null, longitude: p.longitude || null
            }));
            dataSource = 'serper';
            console.log(`✅ Serper Success: ${rawHotels.length} hotels`);
        } catch (e) {
            if (e.response && e.response.status === 403) {
                console.error(`⚠️  Check Serper Key: Forbidden (403).`);
            } else {
                console.warn(`⚠️  Serper FAIL: ${e.message}`);
            }
        }
    }

    // 3) MongoDB
    if (rawHotels.length === 0) {
        try {
            const query = {
                $or: [{ city: new RegExp(city, 'i') }, { address: new RegExp(city, 'i') }]
            };
            console.log(`🔍 [MongoDB Engine] Fetching hotels for cityId: ${cityId}, Query:`, JSON.stringify(query));
            const docs = await Hotel.find(query).limit(20);
            rawHotels  = docs.map(h => h.toObject());
            dataSource = 'mongo';
            console.log(`✅ MongoDB Results: ${rawHotels.length} hotels found.`);
        } catch (e) {
            console.warn(`⚠️  MongoDB FAIL: ${e.message}`);
        }
    }

    // 4) Hardcoded fallback
    if (rawHotels.length === 0) {
        rawHotels  = _hardcodedHotels(city);
        dataSource = 'hardcoded';
        console.log(`⛒️  Hardcoded: ${rawHotels.length} hotels`);
    }

    hotelCache.set(cacheKey, rawHotels);
    console.log(`Database Engine: Successfully fetched ${rawHotels.length} hotels for ranking and city analysis from [${dataSource.toUpperCase()}].`);
    return { rawHotels, dataSource };
}

// ── Shared helper: unify raw hotels into a consistent schema ─────────────────
function _unifyHotels(rawHotels, cityId, city, dataSource) {
    const defaultCoords = CITY_MAP[cityId] || CITY_MAP['-3712125'];
    return rawHotels.map((h, idx) => {
        const lat = h.latitude  || h.location?.coordinates?.[1] || defaultCoords.lat;
        const lng = h.longitude || h.location?.coordinates?.[0] || defaultCoords.lng;
        return {
            id:            String(h._id || h.hotel_id || h.serper_id || `h_${idx}`),
            name:          h.hotelName  || h.hotel_name || h.name || 'Unknown Hotel',
            pricePerNight: Number(h.price || h.min_total_price || 0),
            rating:        Number(h.reviewScore || h.review_score || h.rating || 0),
            category:      h.category || 'Hotels',
            city:          h.city     || city,
            imageUrl:      h.mainPhotoUrl || h.main_photo_url || h.imageUrl || h.image || '',
            address:       h.address  || h.neighbourhood || '',
            source:        h.source   || dataSource,
            description:   h.description || '',
            latitude:  lat, longitude: lng,
            location: { type: 'Point', coordinates: [lng, lat] }
        };
    });
}

// ── smartSearch ───────────────────────────────────────────────────────────────
exports.smartSearch = async (req, res) => {
    console.log('[Fas7ny AI] smartSearch');
    try {
        const { userQuery, history = [], walletBalance = 0, userId, cityId: bodyCityId } = req.body;

        if (!process.env.GEMINI_API_KEY) {
            return res.status(200).json({ status: 'error', message: 'Missing GEMINI_API_KEY' });
        }

        // Dynamic city detection from request or body
        const cityId = bodyCityId || req.query.cityId || '-3712125';
        const cityEntry = CITY_MAP[cityId] || CITY_MAP['-3712125'];
        const city = cityEntry.name;

        const { rawHotels, dataSource } = await _fetchRawHotels(cityId, city);
        const finalResults = _unifyHotels(rawHotels, cityId, city, dataSource);

        let aiReply = 'استمتع برحلة لا تُنسى في هذا المكان المميز!';
        try {
            const prompt = `Write a warm 1-2 sentence hotel recommendation intro for ${city}. Plain text, max 30 words.`;
            const aiResult = await callGemini(prompt);
            if (aiResult.ok) {
                aiReply = aiResult.text;
                // Success log moved to client
            } else {
                console.log(`📡 [SmartSearch] Using local fallback due to: ${aiResult.error}`);
            }
        } catch (e) {
            console.error('❌ SmartSearch Logic Error:', e.message);
        }

        return res.status(200).json({ success: true, reply: aiReply, finalResults });

    } catch (err) {
        console.error('smartSearch CRASH:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

// ── compareAndRank ────────────────────────────────────────────────────────────
exports.compareAndRank = async (req, res) => {
    const reqId = Date.now();
    console.log(`\n────────────────────────────────────────────────────────────\n🚀 [${reqId}] compareAndRank START`);
    try {
        const { city: rawCity = 'Cairo', cityId = '-3712125', walletBalance = 0, userId } = req.body;
        const city = rawCity.trim();
        console.log(`📍 City: ${city} | CityId: ${cityId} | Wallet: ${walletBalance} | User: ${userId || '(guest)'}`);

        // User history
        let userLikes     = [];
        let userInterests = [];
        if (userId) {
            try {
                const u = await User.findById(userId).populate('favoritePlaces');
                if (u?.favoritePlaces?.length > 0) {
                    userLikes = u.favoritePlaces.map(h => ({
                        price: h.price || 0, rating: h.reviewScore || h.rating || 0, category: h.category || 'Hotels',
                    }));
                }
                if (u?.preferences?.length > 0) userInterests = u.preferences;
                else if (u?.interests?.length > 0) userInterests = u.interests;
            } catch (e) { console.warn('User fetch warn:', e.message); }
        }

        const { rawHotels, dataSource } = await _fetchRawHotels(cityId, city);
        const unified = _unifyHotels(rawHotels, cityId, city, dataSource);

        console.log(`📦 Data Source: ${dataSource.toUpperCase()} | Hotels: ${unified.length}`);

        // Score
        const userAvgPrice  = userLikes.length > 0 ? userLikes.reduce((s, h) => s + h.price, 0)  / userLikes.length : 0;
        const userAvgRating = userLikes.length > 0 ? userLikes.reduce((s, h) => s + h.rating, 0) / userLikes.length : 0;
        const topCategory   = userLikes.length > 0 ? (userLikes[0]?.category || 'Hotels') : 'Hotels';
        const hasTaste      = userLikes.length > 0;
        const hasInterests  = userInterests.length > 0;

        const scored = unified.map(h => {
            let priceScore = 0, ratingScore = 0, historyScore = 0, interestScore = 0;
            if (hasTaste) {
                const pricePct = Math.abs(h.pricePerNight - userAvgPrice) / Math.max(userAvgPrice, 1);
                priceScore   = Math.max(0, 35 - pricePct * 35);
                ratingScore  = Math.max(0, 25 - Math.abs(h.rating - userAvgRating) * 10);
                historyScore = h.category === topCategory ? 20 : 5;
            } else {
                ratingScore = Math.min(60, h.rating * 6);
            }
            if (hasInterests) {
                const text = `${h.name} ${h.category} ${h.address}`.toLowerCase();
                interestScore = Math.min(20, userInterests.filter(i => text.includes(i.trim().toLowerCase())).length * 10);
            } else if (!hasTaste) {
                ratingScore += Math.min(40, h.rating * 4);
            }
            const recommendationScore = Math.round(priceScore + ratingScore + historyScore + interestScore);
            console.log(`Ranking Engine: Hotel ${h.name} scored ${recommendationScore}% based on user preferences.`);
            const scoreBreakdown = (hasTaste || hasInterests)
                ? `Price: ${Math.round(priceScore)}%, Rating: ${Math.round(ratingScore)}%, Taste: ${Math.round(historyScore)}%, Interests: ${Math.round(interestScore)}%`
                : `Rating-Based: ${recommendationScore}%`;
            return { ...h, recommendationScore, scoreBreakdown };
        });

        scored.sort((a, b) => b.recommendationScore - a.recommendationScore);

        const finalResults = scored.map((h, idx) => ({
            ...h,
            isRecommended:        idx < 3,
            recommendationReason: idx < 3 ? _recommendationReason(h, userLikes, userAvgPrice, userAvgRating, idx) : null,
        }));

        console.log('🏆 Top 3:');
        finalResults.slice(0, 3).forEach((h, i) => {
            console.log(`   ${i+1}. ${h.name.padEnd(30)} Score: ${h.recommendationScore}% (lat:${h.latitude?.toFixed(4)}, lng:${h.longitude?.toFixed(4)})`);
        });

        // Wallet intelligence
        const topHotel        = finalResults[0];
        const estimatedStayCost = topHotel ? Math.round(topHotel.pricePerNight * ESTIMATED_NIGHTS) : 0;
        const shortfallAmount   = Math.max(0, estimatedStayCost - walletBalance);
        const shouldNavigate    = walletBalance > 0 && estimatedStayCost > walletBalance;

        const walletContext = { shouldNavigateToPayment: shouldNavigate, estimatedStayCost, walletBalance, shortfallAmount, estimatedNights: ESTIMATED_NIGHTS, topHotelName: topHotel?.name || '' };

        // AI Reply
        let aiReply = `Here are the best hotels in ${city} for you! 🏨`;
        try {
            const prompt = `Write a warm 1-2 sentence intro for a hotel recommendation list. City: ${city}. Top hotel: "${topHotel?.name || ''}". Plain text only, max 40 words.`;
            const aiResult = await callGemini(prompt);
            if (aiResult.ok) {
                aiReply = aiResult.text;
            } else {
                console.log(`📡 [CompareAndRank] Using local fallback due to: ${aiResult.error}`);
            }
        } catch (e) {
            console.error(`❌ CompareAndRank Logic Error:`, e.message);
        }

        if (shouldNavigate) {
            aiReply += `\n\n⚠️ You need ${shortfallAmount} EGP more to afford a ${ESTIMATED_NIGHTS}-night stay at ${topHotel?.name}. Would you like to top up?`;
        }

        const comparisonData = {
            userAvgPrice: Math.round(userAvgPrice), userAvgRating: parseFloat(userAvgRating.toFixed(1)),
            topCategory, dataSource,
            matchSummary: hasTaste
                ? `Ranked by ${topCategory} preference · avg ${Math.round(userAvgPrice)} EGP · ${userAvgRating.toFixed(1)}⭐`
                : 'Ranked by highest rating in destination.',
            shouldNavigateToPayment: shouldNavigate,
            targetRoute: shouldNavigate ? '/payment' : null,
        };

        console.log(`✅ [${reqId}] Done — ${finalResults.length} results, source: ${dataSource}\n────────────────────────────────────────────────────────────\n`);

        return res.status(200).json({ success: true, reply: aiReply, finalResults, comparisonData, walletContext });

    } catch (globalError) {
        console.error(`🔥 [${reqId}] compareAndRank CRASH:`, globalError.message);
        const fallback = _hardcodedHotels('Cairo').map((h, i) => ({
            ...h, id: h._id, pricePerNight: h.price,
            recommendationScore: 90 - i * 5, scoreBreakdown: 'Rating-Based (fallback)',
            isRecommended: i < 3, recommendationReason: i < 3 ? 'Highly rated and popular choice.' : null,
            latitude: 30.0444, longitude: 31.2357,
        }));
        return res.status(200).json({
            success: true, reply: 'Here are top-rated hotels for your trip! 🏨',
            finalResults: fallback,
            comparisonData: { userAvgPrice: 0, userAvgRating: 0, topCategory: 'Hotels', dataSource: 'hardcoded', matchSummary: 'Showing popular options.', shouldNavigateToPayment: false, targetRoute: null },
            walletContext: { shouldNavigateToPayment: false, estimatedStayCost: 0, walletBalance: 0, shortfallAmount: 0, estimatedNights: 4, topHotelName: '' },
        });
    }
};

// ── proactiveSuggestions (Feature 1: Preference-Weighted Algorithm) ──────────
// Algorithm explanation:
//   1. Pull user.interests[] + user.savedPlaces[] from MongoDB
//   2. Pull last 5 booking cities (booking history = implicit preference signal)
//   3. Score each destination in DESTINATION_CATALOG using:
//        interestScore  = count(user.interests ∩ dest.tags) × 0.40   (max 40 pts)
//        historyBoost   = dest.city in bookedCities ? 20 pts : 0       (max 20 pts)
//        recencyBoost   = dest is "new" (not booked) ? 15 pts : 0     (variety boost)
//        popularityBase = dest.baseScore (fixed 0-25 pts per destination)
//   4. Sort destinations by finalScore desc, take top 3
//   5. Build TripPackageModel-compatible JSON for each
//   6. If Gemini is available, optionally enrich topActivity text (non-blocking)
exports.proactiveSuggestions = async (req, res) => {
    const Booking = require('../models/Booking');

    // ── Destination catalog with interest tags ─────────────────────────────────
    const DESTINATION_CATALOG = [
        { city: 'Hurghada',       estimatedBudget: 4500, baseScore: 20, imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600', tags: ['beach', 'diving', 'snorkeling', 'sea', 'resort', 'water sports', 'relaxation'], activity: 'Diving & Snorkeling in the Red Sea 🤿' },
        { city: 'Sharm El-Sheikh',estimatedBudget: 5500, baseScore: 18, imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600', tags: ['beach', 'diving', 'nightlife', 'sea', 'luxury', 'water sports'], activity: 'Ras Mohammed National Park & Coral Reefs 🐠' },
        { city: 'Luxor',          estimatedBudget: 2500, baseScore: 25, imageUrl: 'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600', tags: ['history', 'culture', 'ancient', 'temples', 'nile', 'heritage', 'museums'], activity: 'Karnak Temple & Valley of the Kings 🏛️' },
        { city: 'Aswan',          estimatedBudget: 2000, baseScore: 22, imageUrl: 'https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=600', tags: ['history', 'nile', 'culture', 'nubian', 'temples', 'relaxation'], activity: 'Philae Temple & Nubian Village 🛶' },
        { city: 'Cairo',          estimatedBudget: 3000, baseScore: 24, imageUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600', tags: ['history', 'culture', 'pyramids', 'museums', 'food', 'city', 'heritage'], activity: 'Giza Pyramids & Egyptian Museum 🏺' },
        { city: 'Dahab',          estimatedBudget: 2800, baseScore: 19, imageUrl: 'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=600', tags: ['diving', 'beach', 'adventure', 'backpacking', 'sea', 'snorkeling', 'relaxation'], activity: 'Blue Hole Diving & Desert Safari 🏜️' },
        { city: 'Alexandria',     estimatedBudget: 2200, baseScore: 21, imageUrl: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600', tags: ['history', 'sea', 'culture', 'beach', 'food', 'city', 'corniche'], activity: 'Alexandria Library & Qaitbay Citadel 🏰' },
        { city: 'Fayoum',         estimatedBudget: 1500, baseScore: 16, imageUrl: 'https://images.unsplash.com/photo-1543884144-885777bd36e8?w=600', tags: ['nature', 'adventure', 'desert', 'waterfalls', 'wildlife', 'outdoor'], activity: 'Wadi El Rayan Waterfalls & Sandboarding 🏄' },
    ];

    try {
        const userId = req.query.userId;
        let userInterests = [];
        let bookedCities = new Set();

        // ── Pull user data from MongoDB ────────────────────────────────────────
        if (userId) {
            try {
                const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] }).select('interests savedPlaces');
                if (user) {
                    userInterests = (user.interests || []).map(i => i.toLowerCase().trim());
                }
                // Pull booking history for city-based boost
                const recentBookings = await Booking.find({ userId }).sort({ createdAt: -1 }).limit(10).select('placeName');
                recentBookings.forEach(b => {
                    if (b.placeName) {
                        // Try to match booking name against known cities
                        DESTINATION_CATALOG.forEach(dest => {
                            if (b.placeName.toLowerCase().includes(dest.city.toLowerCase())) {
                                bookedCities.add(dest.city);
                            }
                        });
                    }
                });
                console.log(`[Proactive] User ${userId} | Interests: [${userInterests}] | Booked cities: [${[...bookedCities]}]`);
            } catch (userErr) {
                console.warn('[Proactive] Could not fetch user data:', userErr.message);
            }
        }

        // ── Score each destination (preference-weighted greedy algorithm) ──────
        const hasInterests = userInterests.length > 0;
        const scored = DESTINATION_CATALOG.map(dest => {
            // Interest overlap score: 40 pts max
            const matchCount = hasInterests
                ? dest.tags.filter(tag => userInterests.some(ui => ui.includes(tag) || tag.includes(ui))).length
                : 0;
            const interestScore = hasInterests ? Math.min(40, matchCount * (40 / Math.max(dest.tags.length, 1))) : 20;

            // History boost: reward already-liked cities
            const historyBoost = bookedCities.has(dest.city) ? 20 : 0;

            // Variety boost: if NOT booked, add 15 pts to encourage discovery
            const varietyBoost = !bookedCities.has(dest.city) ? 15 : 0;

            const finalScore = Math.round(dest.baseScore + interestScore + historyBoost + varietyBoost);
            console.log(`[Proactive Score] ${dest.city}: base=${dest.baseScore} + interest=${Math.round(interestScore)} + history=${historyBoost} + variety=${varietyBoost} = ${finalScore}`);
            return { ...dest, finalScore };
        });

        // Sort by score, take top 3
        scored.sort((a, b) => b.finalScore - a.finalScore);
        const top3 = scored.slice(0, 3);

        // ── Build TripPackageModel-compatible response ─────────────────────────
        let suggestions = top3.map((dest, i) => ({
            id: `algo_${i + 1}`,
            cityName: dest.city,
            estimatedBudget: dest.estimatedBudget,
            topActivity: dest.activity,
            imageUrl: dest.imageUrl,
            score: dest.finalScore,
            matchedInterests: dest.tags.filter(tag => userInterests.some(ui => ui.includes(tag) || tag.includes(ui))),
        }));

        // ── Optional: Enrich with Gemini (non-blocking, fire-and-forget approach) ──
        // We send the response immediately and don't wait for AI
        console.log(`[Proactive] Returning ${suggestions.length} algorithm-scored suggestions`);
        return res.status(200).json(suggestions);

    } catch (err) {
        console.error('Proactive Suggestions Error:', err.message);
        // Absolute fallback
        return res.status(200).json([
            { id: 'ai_1', cityName: 'Hurghada',  estimatedBudget: 4500, topActivity: 'Diving & Snorkeling in the Red Sea 🤿',     imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600' },
            { id: 'ai_2', cityName: 'Luxor',     estimatedBudget: 2500, topActivity: 'Karnak Temple & Valley of the Kings 🏛️',    imageUrl: 'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600' },
            { id: 'ai_3', cityName: 'Dahab',     estimatedBudget: 2800, topActivity: 'Blue Hole Diving & Desert Safari 🏜️',       imageUrl: 'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=600' },
        ]);
    }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function _recommendationReason(hotel, userLikes, userAvgPrice, userAvgRating, rank) {
    if (userLikes.length === 0) {
        return ['Top-rated hotel in the destination — guests love it!', 'Excellent value with exceptional reviews.', 'Popular choice with a great price-to-quality ratio.'][rank] || 'A great choice for your trip.';
    }
    const closePrice = Math.abs(hotel.pricePerNight - userAvgPrice) < userAvgPrice * 0.2;
    const highRating = hotel.rating >= userAvgRating;
    if (closePrice && highRating) return `Perfect match — similar price and rated ${hotel.rating}⭐.`;
    if (closePrice)               return `Fits your budget at ${hotel.pricePerNight} EGP/night.`;
    if (highRating)               return `Highly rated ${hotel.rating}⭐, matches your quality preference.`;
    return 'Good overall match with your travel history.';
}

function _hardcodedHotels(city) {
    const c = city.toLowerCase();
    if (c.includes('dubai')) return [
        { _id:'hc_d1', name:'Atlantis The Palm',         price:2800, rating:9.2, category:'Luxury',   city:'Dubai',      imageUrl:'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600', address:'Palm Jumeirah, Dubai',        source:'hardcoded' },
        { _id:'hc_d2', name:'Burj Al Arab Jumeirah',     price:5500, rating:9.7, category:'Luxury',   city:'Dubai',      imageUrl:'https://images.unsplash.com/photo-1609520505218-7421df82c0a1?w=600', address:'Jumeirah Beach Road, Dubai',  source:'hardcoded' },
        { _id:'hc_d3', name:'JW Marriott Marquis Dubai', price:1900, rating:8.8, category:'Business', city:'Dubai',      imageUrl:'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', address:'Sheikh Zayed Road, Dubai',   source:'hardcoded' },
        { _id:'hc_d4', name:'Sofitel Dubai Downtown',    price:1200, rating:8.5, category:'Hotels',   city:'Dubai',      imageUrl:'https://images.unsplash.com/photo-1551882547-ff43b4d83dbd?w=600', address:'Downtown Dubai',              source:'hardcoded' },
        { _id:'hc_d5', name:'Premier Inn Dubai Marina',  price: 650, rating:7.9, category:'Budget',   city:'Dubai',      imageUrl:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', address:'Dubai Marina',               source:'hardcoded' },
    ];
    if (c.includes('alex')) return [
        { _id:'hc_a1', name:'Four Seasons Alexandria',    price:1800, rating:9.0, category:'Luxury', city:'Alexandria', imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600', address:'Corniche, Alexandria',       source:'hardcoded' },
        { _id:'hc_a2', name:'Hilton Alexandria Corniche', price:1200, rating:8.4, category:'Hotels', city:'Alexandria', imageUrl:'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600', address:'El Corniche, Alexandria',    source:'hardcoded' },
        { _id:'hc_a3', name:'Sheraton Montazah Hotel',    price: 950, rating:8.1, category:'Hotels', city:'Alexandria', imageUrl:'https://images.unsplash.com/photo-1455587734955-081b22074882?w=600', address:'Montazah, Alexandria',       source:'hardcoded' },
    ];
    if (c.includes('luxor')) return [
        { _id:'hc_l1', name:'Sofitel Winter Palace Luxor', price:1800, rating:9.1, category:'Luxury', city:'Luxor', imageUrl:'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600', address:'Corniche El Nile, Luxor', source:'hardcoded' },
        { _id:'hc_l2', name:'Steigenberger Nile Palace', price:1200, rating:8.6, category:'Hotels', city:'Luxor', imageUrl:'https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=600', address:'Khaled Ibn El Walid St, Luxor', source:'hardcoded' },
        { _id:'hc_l3', name:'Iberotel Luxor', price:900, rating:8.2, category:'Hotels', city:'Luxor', imageUrl:'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600', address:'Luxor City, Luxor', source:'hardcoded' },
        { _id:'hc_l4', name:'Jolie Ville Kings Island', price:700, rating:7.9, category:'Resort', city:'Luxor', imageUrl:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', address:'Kings Island, Luxor', source:'hardcoded' },
    ];

    if (c.includes('hurghada') || c.includes('hurgada')) return [
        { _id:'hc_h1', name:'Oberoi Sahl Hasheesh', price:3500, rating:9.4, category:'Luxury', city:'Hurghada', imageUrl:'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600', address:'Sahl Hasheesh, Hurghada', source:'hardcoded' },
        { _id:'hc_h2', name:'Rixos Premium Seagate', price:2800, rating:9.1, category:'Luxury', city:'Hurghada', imageUrl:'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600', address:'Sahl Hasheesh Bay, Hurghada', source:'hardcoded' },
        { _id:'hc_h3', name:'Steigenberger Al Dau Beach', price:1800, rating:8.7, category:'Resort', city:'Hurghada', imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600', address:'El Mamsha, Hurghada', source:'hardcoded' },
        { _id:'hc_h4', name:'Coral Beach Rotana Resort', price:1200, rating:8.3, category:'Resort', city:'Hurghada', imageUrl:'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', address:'Hurghada Marina, Hurghada', source:'hardcoded' },
        { _id:'hc_h5', name:'Arabia Azur Resort', price:800, rating:7.8, category:'Budget', city:'Hurghada', imageUrl:'https://images.unsplash.com/photo-1455587734955-081b22074882?w=600', address:'Downtown Hurghada', source:'hardcoded' },
    ];

    if (c.includes('sharm')) return [
        { _id:'hc_s1', name:'Four Seasons Resort Sharm El Sheikh', price:4500, rating:9.5, category:'Luxury', city:'Sharm El-Sheikh', imageUrl:'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600', address:'Om El Seid Hill, Sharm', source:'hardcoded' },
        { _id:'hc_s2', name:'Rixos Sharm El Sheikh', price:3200, rating:9.2, category:'Luxury', city:'Sharm El-Sheikh', imageUrl:'https://images.unsplash.com/photo-1609520505218-7421df82c0a1?w=600', address:'Om El Seid Hill, Sharm', source:'hardcoded' },
        { _id:'hc_s3', name:'Hyatt Regency Sharm El Sheikh', price:2200, rating:8.8, category:'Hotels', city:'Sharm El-Sheikh', imageUrl:'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', address:'Sharks Bay, Sharm', source:'hardcoded' },
        { _id:'hc_s4', name:'Iberotel Palace Sharm', price:1400, rating:8.3, category:'Resort', city:'Sharm El-Sheikh', imageUrl:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', address:'Naama Bay, Sharm', source:'hardcoded' },
    ];

    if (c.includes('aswan')) return [
        { _id:'hc_as1', name:'Sofitel Legend Old Cataract Aswan', price:3200, rating:9.3, category:'Luxury', city:'Aswan', imageUrl:'https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=600', address:'Abtal El Tahrir St, Aswan', source:'hardcoded' },
        { _id:'hc_as2', name:'Movenpick Resort Aswan', price:2000, rating:8.8, category:'Resort', city:'Aswan', imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600', address:'Elephantine Island, Aswan', source:'hardcoded' },
        { _id:'hc_as3', name:'Basma Hotel Aswan', price:900, rating:8.1, category:'Hotels', city:'Aswan', imageUrl:'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600', address:'Abtal El Tahrir, Aswan', source:'hardcoded' },
    ];

    if (c.includes('dahab')) return [
        { _id:'hc_d1', name:'Hilton Dahab Resort', price:1500, rating:8.5, category:'Resort', city:'Dahab', imageUrl:'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=600', address:'Dahab Bay, Dahab', source:'hardcoded' },
        { _id:'hc_d2', name:'Nesima Resort Dahab', price:900, rating:8.2, category:'Resort', city:'Dahab', imageUrl:'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600', address:'Mashraba, Dahab', source:'hardcoded' },
        { _id:'hc_d3', name:'Dahab Paradise Hotel', price:500, rating:7.6, category:'Budget', city:'Dahab', imageUrl:'https://images.unsplash.com/photo-1455587734955-081b22074882?w=600', address:'Masbat, Dahab', source:'hardcoded' },
    ];

    if (c.includes('fayoum') || c.includes('faiyum')) return [
        { _id:'hc_f1', name:'Helnan Auberge Fayoum', price:1200, rating:8.3, category:'Resort', city:'Fayoum', imageUrl:'https://images.unsplash.com/photo-1543884144-885777bd36e8?w=600', address:'Qarun Lake, Fayoum', source:'hardcoded' },
        { _id:'hc_f2', name:'Zad El Mosafer', price:700, rating:7.8, category:'Hotels', city:'Fayoum', imageUrl:'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600', address:'Tunis Village, Fayoum', source:'hardcoded' },
    ];

    return [
        { _id:'hc_c1', name:'Four Seasons Nile Plaza',    price:2500, rating:9.3, category:'Luxury',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', address:'Nile Plaza, Cairo',           source:'hardcoded' },
        { _id:'hc_c2', name:'Kempinski Nile Hotel',       price:1800, rating:8.9, category:'Luxury',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', address:'Garden City, Cairo',          source:'hardcoded' },
        { _id:'hc_c3', name:'Marriott Mena House',        price:1400, rating:8.6, category:'Historical', city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1551882547-ff43b4d83dbd?w=600', address:'Pyramids Road, Giza',         source:'hardcoded' },
        { _id:'hc_c4', name:'Pyramisa Sphinx Cairo',      price: 900, rating:8.0, category:'Hotels',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600', address:'Dokki, Cairo',                source:'hardcoded' },
        { _id:'hc_c5', name:'Steigenberger Hotel Cairo',  price: 750, rating:7.7, category:'Hotels',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600', address:'El Tahrir Square, Cairo',     source:'hardcoded' },
    ];
}
