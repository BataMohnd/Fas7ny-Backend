const { GoogleGenerativeAI } = require("@google/generative-ai");
const Hotel = require("../models/HotelModel.js");
const User = require("../models/User");
const axios = require('axios');
const NodeCache = require('node-cache');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });

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
            const docs = await Hotel.find({
                $or: [{ city: new RegExp(city, 'i') }, { address: new RegExp(city, 'i') }]
            }).limit(20);
            rawHotels  = docs.map(h => h.toObject());
            dataSource = 'mongo';
            console.log(`✅ MongoDB: ${rawHotels.length} hotels`);
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

        let aiReply = `Here are the best hotels in ${city} for you! 🏨`;
        try {
            const prompt = `Write a warm 1-2 sentence hotel recommendation intro for ${city}. Plain text, max 30 words.`;
            const r = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
            aiReply = r.response.text().trim() || aiReply;
        } catch (e) {
            console.error('DIRECT GEMINI API ERROR (smartSearch):', e.message);
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
            const r = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
            aiReply = r.response.text().trim() || aiReply;
        } catch (e) {
            console.warn('Gemini reply warn:', e.message);
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

// ── proactiveSuggestions ──────────────────────────────────────────────────────
exports.proactiveSuggestions = async (req, res) => {
    try {
        const userId = req.query.userId;
        let userInterests = [];
        if (userId) {
            const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] });
            if (user?.preferences) userInterests = user.preferences;
            else if (user?.interests) userInterests = user.interests;
        }

        const interestsText = userInterests.length > 0
            ? userInterests.join(', ')
            : 'general travel activities and cultural tours within Egypt';

        const systemInstruction = `You are Fas7ny AI. This user likes: ${interestsText}.
Generate EXACTLY 3 personalized destination packages.
Respond ONLY with a valid JSON array, no markdown:
[
  { "id": "ai_1", "cityName": "City/Trip Name", "estimatedBudget": 5000, "topActivity": "Description", "imageUrl": "https://images.unsplash.com/photo-..." }
]
estimatedBudget should be a realistic number in EGP. No extra text.`;

        const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: systemInstruction }] }] });

        let rawText = result.response.text().trim().replace(/```json|```/g, '').trim();

        let suggestions = [];
        try { suggestions = JSON.parse(rawText); } catch (e) { console.error('Gemini parse error:', e.message); }

        if (!Array.isArray(suggestions) || suggestions.length === 0) {
            suggestions = [
                { id: 'ai_1', cityName: 'Dahab',  estimatedBudget: 3000, topActivity: 'Discover the Blue Hole', imageUrl: 'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=600' },
                { id: 'ai_2', cityName: 'Fayoum', estimatedBudget: 1500, topActivity: 'Wadi El Rayan waterfalls and sandboarding', imageUrl: 'https://images.unsplash.com/photo-1543884144-885777bd36e8?w=600' },
                { id: 'ai_3', cityName: 'Luxor',  estimatedBudget: 2000, topActivity: 'Explore ancient Egyptian history', imageUrl: 'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600' },
            ];
        }
        return res.status(200).json(suggestions);
    } catch (err) {
        console.error('Proactive AI Error:', err);
        return res.status(500).json({ error: 'Failed to fetch AI suggestions' });
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
    return [
        { _id:'hc_c1', name:'Four Seasons Nile Plaza',    price:2500, rating:9.3, category:'Luxury',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', address:'Nile Plaza, Cairo',           source:'hardcoded' },
        { _id:'hc_c2', name:'Kempinski Nile Hotel',       price:1800, rating:8.9, category:'Luxury',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', address:'Garden City, Cairo',          source:'hardcoded' },
        { _id:'hc_c3', name:'Marriott Mena House',        price:1400, rating:8.6, category:'Historical', city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1551882547-ff43b4d83dbd?w=600', address:'Pyramids Road, Giza',         source:'hardcoded' },
        { _id:'hc_c4', name:'Pyramisa Sphinx Cairo',      price: 900, rating:8.0, category:'Hotels',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600', address:'Dokki, Cairo',                source:'hardcoded' },
        { _id:'hc_c5', name:'Steigenberger Hotel Cairo',  price: 750, rating:7.7, category:'Hotels',     city:'Cairo', imageUrl:'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=600', address:'El Tahrir Square, Cairo',     source:'hardcoded' },
    ];
}
