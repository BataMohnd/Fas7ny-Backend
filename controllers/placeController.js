const axios = require('axios');
const mongoose = require('mongoose');
const Hotel = require('../models/HotelModel');
const Place = require('../models/Place'); // Added Place model reference
const NearbyPlaceCache = require('../models/NearbyPlaceCache');
const crypto = require('crypto');

// 1. Triple-Source Fallback Data (Static as last resort)
const staticFallbackData = [
    {
        hotelId: "static-1",
        hotelName: "Pyramids View Hotel",
        mainPhotoUrl: "https://images.unsplash.com/photo-1572248523429-ca7f897f2662",
        address: "Giza Pyramids, Cairo",
        price: 1200,
        currency: "EGP",
        reviewScore: 4.8,
        rating: 4.8, // Added for UI sync
        reviewCount: 150
    },
    {
        hotelId: "static-2",
        hotelName: "Steigenberger Nile Palace",
        mainPhotoUrl: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb",
        address: "Luxor City Council, Luxor",
        price: 3500,
        currency: "EGP",
        reviewScore: 4.9,
        rating: 4.9, // Added for UI sync
        reviewCount: 280
    }
];

// 1. جلب الفنادق (Universal Logic: RapidAPI -> MongoDB -> Static)
exports.getHotels = async (req, res) => {
    try {
        const cityId = req.query.cityId || '-3712125';
        let hotels = [];
        let source = 'rapidapi';

        try {
            console.log("🚀 Attempting RapidAPI Fetch...");
            const options = {
                method: 'GET',
                url: 'https://apidojo-booking-v1.p.rapidapi.com/properties/v2/list',
                params: {
                    dest_ids: String(cityId),
                    arrival_date: '2026-08-15',
                    departure_date: '2026-08-20',
                    guest_qty: '1',
                    room_qty: '1',
                    search_type: 'city',
                    sort_by: 'popularity',
                    units: 'metric',
                    locale: 'en_gb'
                },
                headers: {
                    'x-rapidapi-key': process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
                    'x-rapidapi-host': 'apidojo-booking-v1.p.rapidapi.com'
                }
            };

            const response = await axios.request(options);
            
            // Support multiple response shapes from Booking.com RapidAPI
            const rawData =
                response.data?.result ||
                response.data?.data?.results ||
                response.data?.data ||
                (Array.isArray(response.data) ? response.data : []);

            hotels = rawData.map(h => ({
                hotelId: (h.hotel_id || h.property_id || h.id || crypto.randomUUID()).toString(),
                cityId: cityId,
                hotelName: h.hotel_name || h.property_name || h.name || 'Unknown Hotel',
                mainPhotoUrl: h.main_photo_url || h.mainPhotoUrl || (h.photoUrls && h.photoUrls.length > 0 ? h.photoUrls[0] : null),
                address: h.address || h.address_trans || 'Unknown Address',
                city: h.city || '',
                price: req.formatPrice
                    ? req.formatPrice(h.price || h.min_total_price || h.compositePrice || 500)
                    : (h.price || h.min_total_price || h.compositePrice || 500),
                currency: req.userCurrency || 'EGP',
                reviewScore: (h.review_score || h.reviewScore || 0.0),
                rating: (h.review_score || h.reviewScore || 4.5),
                image: h.main_photo_url || h.mainPhotoUrl,
                reviewCount: (h.review_nr || h.reviewCount || 0)
            }));
            console.log(`✅ RapidAPI Success: Extracted ${hotels.length} hotels.`);

        } catch (apiError) {
            console.warn("⚠️ RapidAPI Failed, trying MongoDB...");
            source = 'mongodb';
            try {
                const dbHotels = await Hotel.find({ cityId: cityId });
                if (dbHotels.length > 0) {
                    hotels = dbHotels.map(h => ({
                        hotelId: h.hotelId,
                        hotelName: h.hotelName,
                        mainPhotoUrl: h.mainPhotoUrl || h.image_url,
                        image: h.image_url || h.mainPhotoUrl,
                        address: h.address,
                        price: req.formatPrice ? req.formatPrice(h.price || 500) : h.price,
                        currency: req.userCurrency || 'EGP',
                        rating: 4.5,
                        reviewCount: h.reviewCount || 0
                    }));
                    console.log("✅ MongoDB Injection Success");
                } else {
                    console.warn("⚠️ MongoDB Empty, falling back to Static Data...");
                    source = 'static';
                    hotels = staticFallbackData.map(h => ({
                        ...h,
                        price: req.formatPrice ? req.formatPrice(h.price) : h.price,
                        currency: req.userCurrency || 'EGP'
                    }));
                }
            } catch (dbErr) {
                console.error("❌ MongoDB Fetch Error:", dbErr.message);
                source = 'static';
                hotels = staticFallbackData.map(h => ({ ...h, currency: 'EGP' }));
            }
        }

        // 2. Optimized Response Timing (Bounded Concurrency & Timeouts)
        const { generateSentimentSummary } = require('../services/sentimentAnalyzer');

        /**
         * ⏲️ Timeout Wrapper Helper
         */
        const withTimeout = (promise, ms = 4000) => {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Sentiment timeout')), ms))
            ]);
        };

        // Process sentiment ONLY for top 3 hotels concurrently
        const sentimentPromises = hotels.slice(0, 3).map(async (h) => {
            if (h.sentimentSummary) return;
            try {
                h.sentimentSummary = await withTimeout(generateSentimentSummary(h.rating || 4.5, h.address));
                Hotel.updateOne({ hotelId: h.hotelId }, { sentimentSummary: h.sentimentSummary }).catch(e => {});
            } catch (err) {
                console.warn(`⚠️ [Sentiment Fallback] ${h.hotelName}: ${err.message}`);
                h.sentimentSummary = "تجربة سياحية مميزة تم تقييمها بعناية لتناسب تفضيلاتك.";
            }
        });

        console.log(`🤖 Sentiment processing started for top 3 hotels (Max wait: 4s)...`);
        await Promise.allSettled(sentimentPromises);
        console.log(`⚡ Returning ${hotels.length} hotels comfortably within timeout limits.`);

        res.status(200).json({ success: true, source, data: hotels });

    } catch (err) {
        console.error('🔥 CRITICAL ERROR IN getHotels:', err.message);
        res.status(500).json({ success: false, message: "فشل في جلب بيانات الفنادق. يرجى المحاولة لاحقاً." });
    }
};

// 1.5 Get Hotel by ID (Dual Lookup)
exports.getHotelDetails = async (req, res) => {
    try {
        const { hotelId } = req.params;

        // 1. Try finding by hotelId (RapidAPI/Custom field)
        let hotel = await Hotel.findOne({ hotelId });

        // 2. Fallback: Try finding by MongoDB _id (if the passed ID is a valid ObjectId string)
        if (!hotel && mongoose.Types.ObjectId.isValid(hotelId)) {
            hotel = await Hotel.findById(hotelId);
        }

        if (hotel) {
            res.status(200).json({ success: true, data: hotel });
        } else {
            // 3. Fallback for static hotels
            const staticH = staticFallbackData.find(h => h.hotelId === hotelId);
            if (staticH) {
                res.status(200).json({ success: true, data: staticH });
            } else {
                res.status(404).json({ success: false, message: "Hotel not found" });
            }
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. البحث عن الأماكن (Wallet-Aware Search)
exports.searchPlaces = async (req, res) => {
    try {
        const query = req.query.name || req.query.query;
        const city = req.query.city;
        const budget = parseFloat(req.query.budget);

        let filter = {};

        if (city) {
            filter.city = new RegExp(city, 'i');
        }

        if (query) {
            filter.$or = [
                { name: new RegExp(query, 'i') },
                { description: new RegExp(query, 'i') }
            ];
        }

        let combinedResults = [];

        // If budget is provided, apply Wallet-Aware Logic
        if (!isNaN(budget) && budget > 0) {
            // Find affordable places prioritizing those under 50% of budget
            combinedResults = await Place.find({
                ...filter,
                price: { $lte: budget }
            }).sort({ price: 1 }).limit(20).lean();
        } else {
            combinedResults = await Place.find(filter).limit(20).lean();
        }

        // Map data consistently
        combinedResults = combinedResults.map(p => ({
            id: p._id || p.id,
            name: p.name,
            imageUrl: p.imageUrl || p.image_url || p.mainPhotoUrl || 'https://via.placeholder.com/150',
            price: p.price,
            category: p.category || 'General',
            neighbourhood: p.neighbourhood || p.city,
            currency: 'EGP',
            rating: p.rating || 4.5,
            numberOfReviews: p.numberOfReviews || 0,
            description: p.description,
            source: 'mongo'
        }));

        // --- ENHANCED FALLBACK: Trigger RapidAPI if 0 results found ---
        if (combinedResults.length === 0) {
            console.log(`⚠️ Search empty for "${query}". Triggering External Fallback...`);
            try {
                // 1. Find a Destination ID first
                const locationRes = await axios.get('https://apidojo-booking-v1.p.rapidapi.com/locations/v2/search', {
                    params: { name: query, locale: 'en-gb' },
                    headers: {
                        'x-rapidapi-key': process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
                        'x-rapidapi-host': 'apidojo-booking-v1.p.rapidapi.com'
                    }
                });

                const destId = locationRes.data?.dest_id || locationRes.data?.[0]?.dest_id;
                if (destId) {
                    console.log(`✅ Found External Destination ID: ${destId}`);
                    // 2. Fetch properties for this destination
                    const hotelRes = await axios.get('https://apidojo-booking-v1.p.rapidapi.com/properties/v2/list', {
                        params: {
                            dest_ids: String(destId),
                            arrival_date: '2026-08-15',
                            departure_date: '2026-08-20',
                            guest_qty: '1',
                            room_qty: '1',
                            search_type: 'city',
                            sort_by: 'popularity',
                            units: 'metric'
                        },
                        headers: {
                            'x-rapidapi-key': process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
                            'x-rapidapi-host': 'apidojo-booking-v1.p.rapidapi.com'
                        }
                    });

                    const rawResults = hotelRes.data?.result || hotelRes.data?.data?.results || [];
                    console.log(`📦 Fetched ${rawResults.length} external hotels for caching.`);

                    const newHotels = rawResults.map(h => ({
                        hotelId: (h.hotel_id || h.id || crypto.randomUUID()).toString(),
                        cityId: String(destId),
                        hotelName: h.hotel_name || h.name || 'External Hotel',
                        mainPhotoUrl: h.main_photo_url || h.image_url,
                        address: h.address || 'Cairo, Egypt',
                        price: h.price || h.min_total_price || 1200,
                        currency: 'EGP',
                        reviewScore: h.review_score || 4.5,
                        rating: h.review_score || 4.5,
                        reviewCount: h.review_nr || 0
                    }));

                    // Silent persistence (Don't await to keep search fast, or await if you want data integrity)
                    if (newHotels.length > 0) {
                        Hotel.insertMany(newHotels, { ordered: false }).catch(e => console.log("Cache conflict (Normal)"));
                    }

                    // 4. Transform for the current search response
                    combinedResults = newHotels.map(h => ({
                        ...h,
                        source: 'external',
                        relevanceScore: scoreMatch({ hotelName: h.hotelName }, query)
                    })).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 10);
                }
            } catch (fallbackError) {
                console.error("🚨 Search Fallback Failed:", fallbackError.message);
            }
        }

        res.status(200).json({
            success: true,
            data: combinedResults
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. جلب كل الأماكن (Fixed model usage)
exports.getAllPlaces = async (req, res) => {
    try {
        const places = await Place.find();
        // Return wrapped in 'data' for Flutter robustness
        res.status(200).json({ status: 'success', data: places });
    } catch (err) {
        res.status(500).json({ status: 'fail', message: err.message });
    }
};

// 4. Attractions Logic (Consolidated from attractionController)
exports.getAttractionAvailability = async (req, res) => {
    const { attractionId, date } = req.query;
    try {
        const options = {
            method: 'GET',
            url: 'https://booking-com.p.rapidapi.com/v1/attractions/availability',
            params: {
                date: date || '2026-09-18',
                attraction_id: attractionId || 'PRFZkGSVnM5d',
                locale: 'en-gb',
                currency: req.userCurrency || 'EGP'
            },
            headers: {
                'x-rapidapi-key': process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
                'x-rapidapi-host': 'booking-com.p.rapidapi.com'
            }
        };
        const response = await axios.request(options);
        res.status(200).json({ success: true, data: response.data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 5. Booking Calculation (Advanced Logic)
exports.calculateBookingPrice = async (req, res) => {
    try {
        const { basePrice, startDate, endDate, mealPlan, extras } = req.body;

        const start = new Date(startDate);
        const end = new Date(endDate);
        const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

        let totalPrice = basePrice * (nights > 0 ? nights : 1);

        // Meal plan adjustments
        if (mealPlan === 'half_board') totalPrice += (nights * 200);
        if (mealPlan === 'full_board') totalPrice += (nights * 500);

        // Extras
        if (extras.includes('airport_transfer')) totalPrice += 300;
        if (extras.includes('guided_tour')) totalPrice += 700;

        // Apply Currency Formatting
        const finalPrice = req.formatPrice ? req.formatPrice(totalPrice) : totalPrice;

        res.status(200).json({
            success: true,
            originalEgp: totalPrice,
            finalPrice: finalPrice,
            currency: req.userCurrency || 'EGP',
            breakdown: { nights, mealPlan, extrasCount: extras.length }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 6. Nearest Neighbor with Fetch & Cache (Serper Fallback)
exports.getNearbyAttractions = async (req, res) => {
    try {
        const { lng, lat, maxDistance = 2000 } = req.query;

        // -- STEP 0: Ground Truth Coordinate Resolver --
        let numericLat = parseFloat(lat);
        let numericLng = parseFloat(lng);
        let cityContext = "Cairo";

        const cityMap = {
            '-3712125': { name: "Cairo", lat: 30.0444, lng: 31.2357 },
            '8': { name: "Dubai", lat: 25.2048, lng: 55.2708 },
            '-3712078': { name: "Alexandria", lat: 31.2001, lng: 29.9187 }
        };

        const cityId = req.query.cityId || '-3712125';
        const verified = cityMap[cityId];

        if (verified) {
            if (isNaN(numericLat) || isNaN(numericLng)) {
                numericLat = verified.lat;
                numericLng = verified.lng;
                console.log(`📍 NN Logic: Using Verified Demo Coordinates for ${verified.name} [${numericLat}, ${numericLng}]`);
            }
            cityContext = verified.name;
        }

        // -- STEP 1: Search MongoDB Cache (2dsphere $near) --
        let nearbyPlaces = await Place.find({
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [numericLng, numericLat]
                    },
                    $maxDistance: parseInt(maxDistance)
                }
            },
            category: { $in: ['cafe', 'restaurant', 'attraction'] }
        }).limit(5);

        // Cache Hit!
        if (nearbyPlaces.length > 0) {
            console.log("✅ NN Cache Hit! Returning from MongoDB.");
            return res.status(200).json({
                message: "Nearest neighbors found successfully",
                source: "mongodb",
                count: nearbyPlaces.length,
                data: nearbyPlaces
            });
        }

        // -- STEP 2: Cache Miss, trigger live Serper API --
        console.log(`⚠️ NN Cache Miss! Fetching live from Serper API...`);
        const serperKey = process.env.SERPER_API_KEY;
        const serperUrl = 'https://google.serper.dev/places';
        
        if (!serperKey) {
            return res.status(200).json({ success: true, source: "fallback", data: _getCuratedFallback(cityContext) });
        }

        let rawPlaces = [];
        try {
            console.log(`📡 [Serper API] Requesting neighborhood data: POST ${serperUrl}`);
            const serperRes = await axios.post(serperUrl, {
                q: `Cafes, restaurants and attractions near ${numericLat}, ${numericLng}`,
                location: `${numericLat},${numericLng}`
            }, {
                headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
                timeout: 8000
            });
            console.log(`✅ [Serper API] Response: ${serperRes.status} OK`);
            rawPlaces = serperRes.data?.places || [];
        } catch (e) {
            const status = e.response?.status;
            console.error(`❌ [Serper API] External Provider Error: [Status ${status}] | URL: ${serperUrl}`);
            if (status === 403) {
                console.warn(`⚠️ Auth Failure (403): Triggering [${cityContext}] curated neighborhood fallback.`);
                return res.status(200).json({
                    success: true,
                    message: "Using curated demo fallback",
                    source: "curated_fallback",
                    data: _getCuratedFallback(cityContext)
                });
            }
        }
        
        if (rawPlaces.length === 0) {
           return res.status(200).json({ data: [] });
        }

        // -- STEP 3: Map & Insert Array --
        const newPlacesToInsert = rawPlaces.map(p => ({
            name: p.title || "Unnamed Place",
            description: p.address || "",
            price: 150, // Default mock price
            neighbourhood: "Nearby",
            imageUrl: p.imageUrl || "https://images.unsplash.com/photo-1554118811-1e0d58224f24",
            category: p.category ? p.category.toLowerCase() : "restaurant",
            rating: p.rating || 4.5,
            numberOfReviews: p.ratingCount || Math.floor(Math.random() * 100),
            latitude: p.latitude || numericLat,
            longitude: p.longitude || numericLng,
            location: {
                type: "Point",
                coordinates: [p.longitude || numericLng, p.latitude || numericLat]
            }
        }));

        // Fire and Forget
        try {
            await Place.insertMany(newPlacesToInsert, { ordered: false });
            console.log("📦 Inserted live fetched places into MongoDB cache");
        } catch (dbErr) {
            console.error("DB Insert Warning:", dbErr.message);
        }

        // We only want to return top 5
        const finalResults = await Place.find({
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [numericLng, numericLat]
                    },
                    $maxDistance: parseInt(maxDistance)
                }
            },
            category: { $in: ['cafe', 'restaurant', 'attraction'] }
        }).limit(5);

        res.status(200).json({
            message: "Live fetch successful & cached",
            source: "serper",
            count: finalResults.length,
            data: finalResults.length > 0 ? finalResults : newPlacesToInsert.slice(0, 5)
        });

    } catch (error) {
        console.error("🔥 Nearest Neighbor Error:", error);
        res.status(500).json({ error: "Failed to fetch nearby places" });
    }
};

/**
 * 🏗️ Curated Demo-Ready Neighborhood Fallbacks
 */
function _getCuratedFallback(city) {
    const c = city.toLowerCase();
    if (c.includes('cairo')) return [
        { name: 'Naguib Mahfouz Cafe', category: 'restaurant', rating: 4.8, imageUrl: 'https://images.unsplash.com/photo-1553913861-c0fddf2619ee', description: 'Famous historical cafe in Khan El Khalili' },
        { name: 'Abou El Sid', category: 'restaurant', rating: 4.6, imageUrl: 'https://images.unsplash.com/photo-1606491956689-2ea866880c84', description: 'Classic Egyptian dining experience in Zamalek' },
        { name: 'Zeba', category: 'cafe', rating: 4.5, imageUrl: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24', description: 'Modern cozy cafe with Nile view' }
    ];
    if (c.includes('alex')) return [
        { name: 'Greek Club', category: 'restaurant', rating: 4.7, imageUrl: 'https://images.unsplash.com/photo-1544124499-58912cbddaad', description: 'Iconic view of the Eastern Harbor' },
        { name: 'Fish Market', category: 'restaurant', rating: 4.8, imageUrl: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2', description: 'Fresh Mediterranean seafood' }
    ];
    return [{ name: 'Modern Egyptian Resto', category: 'restaurant', rating: 4.5, imageUrl: 'https://via.placeholder.com/150', description: 'Cozy local spot' }];
}

// 7. Nearby Discovery System (Google Places + Cache + Multi-tier Fallback)
exports.getNearbyPlaces = async (req, res) => {
    const { getCityCoordinates } = require('../utils/locationResolver');
    const { searchNearbyPlaces } = require('../services/googlePlacesService');
    const NearbyPlaceCache = require('../models/NearbyPlaceCache');

    try {
        const { city, lat, lng, type = 'all', radius = 5000 } = req.query;
        const normalizedType = ['restaurant', 'cafe', 'entertainment', 'dining', 'all'].includes(type) ? type : 'all';
        const numRadius = parseInt(radius) || 5000;

        // 1. Resolve Coordinates: Prioritize live lat/lng from request
        let targetLat = parseFloat(lat);
        let targetLng = parseFloat(lng);
        let coordSource = "live_location";

        if (isNaN(targetLat) || isNaN(targetLng)) {
            const demoCoords = getCityCoordinates(city);
            if (demoCoords) {
                targetLat = demoCoords.lat;
                targetLng = demoCoords.lng;
                coordSource = `demo_city_fallback (${city})`;
            } else {
                targetLat = 30.0444; 
                targetLng = 31.2357;
                coordSource = "default_fallback (Cairo)";
            }
        }

        console.log(`📍 Nearby Search - Center: [${targetLat}, ${targetLng}] | Source: ${coordSource} | Type: ${normalizedType} | Radius: ${numRadius}m`);

        // 2. Cache Check (queryKey construction)
        // Use rounded coordinates (3 decimal places ~= 110m precision) to avoid cache explosion
        const roundedLat = targetLat.toFixed(3);
        const roundedLng = targetLng.toFixed(3);
        const queryKey = `${roundedLat}:${roundedLng}:${normalizedType}:${numRadius}`;

        let cached = await NearbyPlaceCache.findOne({ queryKey });

        if (cached && cached.expiresAt > new Date()) {
            console.log(`💾 Cache HIT: ${queryKey}`);
            return res.status(200).json({
                success: true,
                source: "cache",
                count: cached.items.length,
                items: cached.items
            });
        }

        // 3. Live Google Places Fetch
        try {
            console.log(`💾 Cache MISS → fetching from API: ${queryKey}`);
            let items = await searchNearbyPlaces({ 
                lat: targetLat, 
                lng: targetLng, 
                radius: numRadius, 
                type: normalizedType 
            });

            // 3.1 Calculate Distances & Enhanced Sorting (Rating DESC -> Distance ASC -> Price ASC)
            items = items.map(item => {
                if (item.location && item.location.latitude && item.location.longitude) {
                    const dist = _calculateHaversineDistance(
                        targetLat, targetLng, 
                        item.location.latitude, item.location.longitude
                    );
                    return { ...item, distanceKm: parseFloat(dist.toFixed(2)), price: item.price || 150 };
                }
                return { ...item, distanceKm: null, price: item.price || 150 };
            });

            // Enhanced Sorting Logic
            items.sort((a, b) => {
                // 1. Rating DESC
                if ((b.rating || 0) !== (a.rating || 0)) {
                    return (b.rating || 0) - (a.rating || 0);
                }
                // 2. Distance ASC
                if (a.distanceKm !== b.distanceKm) {
                    if (a.distanceKm === null) return 1;
                    if (b.distanceKm === null) return -1;
                    return a.distanceKm - b.distanceKm;
                }
                // 3. Price ASC
                return (a.price || 0) - (b.price || 0);
            });

            console.log(`📏 Calculated distance for ${items.length} places & sorted nearest-first.`);

            // Update Cache (Save or Update)
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await NearbyPlaceCache.findOneAndUpdate(
                { queryKey },
                {
                    queryKey,
                    city: city || 'geolocation',
                    category: normalizedType,
                    center: { type: 'Point', coordinates: [targetLng, targetLat] },
                    items: items,
                    fetchedAt: new Date(),
                    expiresAt: expiresAt
                },
                { upsert: true, new: true }
            );

            return res.status(200).json({
                success: true,
                source: "google_places",
                count: items.length,
                items: items
            });

        } catch (apiError) {
            console.warn(`⚠️ External API Failure: ${apiError.message}. Attempting failover...`);
            
            // Failover Strategy 1: Stale Cache
            if (cached) {
                console.log("🔄 Failover: Returning stale cache data.");
                return res.status(200).json({
                    success: true,
                    source: "stale_cache",
                    count: cached.items.length,
                    items: cached.items
                });
            }

            // Failover Strategy 2: Curated Fallbacks
            const status = apiError.response?.status || 500;
            let reason = "Unknown failure";
            if (status === 400) reason = "Invalid request / unsupported type";
            else if (status === 403) reason = "Permission/auth issue";
            else if (status === 503) reason = "Provider unavailable";

            console.log(`⚠️ External API ${status} (${reason}) → fallback triggered for ${city || 'current location'}`);
            const fallbackResults = _getCuratedNearbyFallback(city, normalizedType);
            return res.status(200).json({
                success: true,
                source: "curated_fallback",
                count: fallbackResults.length,
                items: fallbackResults
            });
        }

    } catch (err) {
        console.error("🔥 Nearby Places CRASH:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * 🏗️ Curated Type-Aware Fallbacks
 */
function _getCuratedNearbyFallback(city = 'Cairo', type = 'all') {
    const cityName = city?.toLowerCase() || 'cairo';
    
    // Fallback Data Store
    const fallbacks = {
        cairo: {
            restaurant: [
                { name: "Koshary Abou Tarek", address: "Champollion Rd, Cairo", rating: 4.8, category: "restaurant", imageUrl: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4" },
                { name: "Naguib Mahfouz Cafe", address: "Khan el-Khalili, Cairo", rating: 4.6, category: "restaurant", imageUrl: "https://images.unsplash.com/photo-1544124499-58912cbddaad" }
            ],
            entertainment: [
                { name: "Great Pyramids of Giza", address: "Al Haram, Giza", rating: 4.9, category: "attraction", imageUrl: "https://images.unsplash.com/photo-1503177119275-0aa32b3a9368" },
                { name: "Egyptian Museum", address: "Tahrir Square, Cairo", rating: 4.7, category: "museum", imageUrl: "https://images.unsplash.com/photo-1518998053574-53ee81eb6449" }
            ]
        },
        alexandria: {
            restaurant: [
                { name: "Fish Market", address: "Corniche, Alexandria", rating: 4.7, category: "restaurant", imageUrl: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2" }
            ],
            entertainment: [
                { name: "Bibliotheca Alexandrina", address: "Corniche, Alex", rating: 4.9, category: "museum", imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945" },
                { name: "Citadel of Qaitbay", address: "Eastern Harbor, Alex", rating: 4.7, category: "attraction", imageUrl: "https://images.unsplash.com/photo-1571896349842-33c89424de2d" }
            ]
        },
        dubai: {
            restaurant: [
                { name: "Al Baik", address: "Dubai Mall", rating: 4.8, category: "restaurant", imageUrl: "https://images.unsplash.com/photo-1582281227059-591b4070073c" }
            ],
            entertainment: [
                { name: "Burj Khalifa", address: "Downtown Dubai", rating: 4.9, category: "attraction", imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab" },
                { name: "Museum of the Future", address: "Sheikh Zayed Rd, Dubai", rating: 4.9, category: "museum", imageUrl: "https://images.unsplash.com/photo-1582650625119-3a31f8fa26ec" }
            ]
        }
    };

    const targetCity = fallbacks[cityName] || fallbacks.cairo;
    
    if (type === 'restaurant') return targetCity.restaurant;
    if (type === 'entertainment') return targetCity.entertainment;
    return [...targetCity.restaurant, ...targetCity.entertainment];
}

/**
 * 📏 Geographic distance formula (Haversine)
 */
function _calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
}

exports.getNearbyHotels = async (req, res) => {
    try {
        const { lat, lng, city = "Cairo" } = req.query;
        let hotels = [];
        
        // 1. Try RapidAPI search by location if lat/lng present
        if (lat && lng) {
            try {
                const options = {
                    method: 'GET',
                    url: 'https://apidojo-booking-v1.p.rapidapi.com/properties/v2/list-by-lat-lng',
                    params: {
                        latitude: lat,
                        longitude: lng,
                        arrival_date: '2026-08-15',
                        departure_date: '2026-08-20',
                        guest_qty: '1',
                        room_qty: '1',
                        sort_by: 'popularity',
                        units: 'metric',
                        locale: 'en_gb'
                    },
                    headers: {
                        'x-rapidapi-key': process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
                        'x-rapidapi-host': 'apidojo-booking-v1.p.rapidapi.com'
                    }
                };
                const response = await axios.request(options);
                const rawData = response.data?.result || response.data?.data?.results || [];
                hotels = rawData.map(h => ({
                    hotelId: (h.hotel_id || h.id || crypto.randomUUID()).toString(),
                    hotelName: h.hotel_name || h.name || 'Unknown Hotel',
                    mainPhotoUrl: h.main_photo_url || h.image_url,
                    address: h.address || 'Nearby Location',
                    price: h.price || h.min_total_price || 1200,
                    currency: 'EGP',
                    rating: h.review_score || 4.5,
                    reviewCount: h.review_nr || 0,
                    distance: h.distance ? parseFloat(h.distance).toFixed(1) : "0.5"
                }));
            } catch (apiErr) {
                console.warn("⚠️ Nearby Hotels RapidAPI failed, falling back to city hotels");
            }
        }

        // 2. Fallback to regular getHotels logic (city based)
        if (hotels.length === 0) {
            req.query.cityId = city === 'Alexandria' ? '-3712078' : '-3712125';
            return exports.getHotels(req, res);
        }

        res.status(200).json({ success: true, source: 'rapidapi_nearby', data: hotels });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const _arabicCityMap = {
    'الغردقة':       'Hurghada',
    'القاهرة':       'Cairo',
    'الاسكندرية':    'Alexandria',
    'الإسكندرية':    'Alexandria',
    'الاسكندريه':    'Alexandria',
    'شرم الشيخ':     'Sharm El-Sheikh',
    'شرم':           'Sharm El-Sheikh',
    'الأقصر':        'Luxor',
    'الاقصر':        'Luxor',
    'أسوان':         'Aswan',
    'اسوان':         'Aswan',
    'دهب':           'Dahab',
    'الفيوم':        'Fayoum',
    'دبي':           'Dubai',
};

const priceLevelMap = {
  'PRICE_LEVEL_FREE': 0,
  'PRICE_LEVEL_INEXPENSIVE': 500,
  'PRICE_LEVEL_MODERATE': 1200,
  'PRICE_LEVEL_EXPENSIVE': 2500,
  'PRICE_LEVEL_VERY_EXPENSIVE': 5000,
};

exports.getHotelsByCity = async (req, res) => {
    try {
        const rawCity = req.query.city;
        if (!rawCity) return res.status(400).json({ success: false, message: "city query parameter is required" });

        const city = _arabicCityMap[rawCity.trim()] || rawCity.trim();
        const queryKey = `hotels_city_${city.toLowerCase()}`;

        // Check Cache First
        const cached = await NearbyPlaceCache.findOne({ queryKey });
        if (cached && cached.items && cached.items.length > 0) {
            console.log(`[Google Hotels] Cache hit for ${city}`);
            return res.status(200).json({ success: true, source: 'cache', data: cached.items });
        }

        console.log(`[Google Hotels] Geocoding ${city}...`);
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const geoRes = await axios.get(geoUrl);
        
        if (!geoRes.data.results || geoRes.data.results.length === 0) {
            console.warn(`[Google Hotels] Geocoding failed for ${city}`);
            // Fallback to regular getHotels logic
            return exports.getHotels(req, res);
        }

        const { lat, lng } = geoRes.data.results[0].geometry.location;

        console.log(`[Google Hotels] Fetching nearby hotels for ${city} at ${lat}, ${lng}...`);
        const placesUrl = 'https://places.googleapis.com/v1/places:searchNearby';
        const headers = {
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.displayName,places.location,places.rating,places.priceLevel,places.photos,places.formattedAddress,places.id',
            'Content-Type': 'application/json'
        };
        const body = {
            includedTypes: ['lodging'],
            locationRestriction: {
                circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: 5000
                }
            },
            maxResultCount: 20
        };

        const placesRes = await axios.post(placesUrl, body, { headers });
        const rawPlaces = placesRes.data.places || [];

        if (rawPlaces.length === 0) {
            console.warn(`[Google Hotels] No hotels found for ${city}`);
            return exports.getHotels(req, res);
        }

        const hotels = rawPlaces.map(p => {
            let imageUrl = null;
            if (p.photos && p.photos.length > 0) {
                const photoReference = p.photos[0].name;
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?maxHeightPx=400&maxWidthPx=400&key=${process.env.GOOGLE_MAPS_API_KEY}`;
            }

            return {
                hotelId: p.id,
                hotelName: p.displayName?.text || 'Unknown Hotel',
                rating: p.rating || 4.0,
                reviewScore: p.rating || 4.0,
                price: priceLevelMap[p.priceLevel] || 1500,
                currency: 'EGP',
                mainPhotoUrl: imageUrl,
                image: imageUrl,
                address: p.formattedAddress || city,
                latitude: p.location?.latitude,
                longitude: p.location?.longitude,
                city: city,
                source: 'google_places'
            };
        });

        // Save to cache (TTL: 30 mins)
        await NearbyPlaceCache.findOneAndUpdate(
            { queryKey },
            {
                queryKey,
                city,
                category: 'hotels',
                center: { type: 'Point', coordinates: [lng, lat] },
                items: hotels,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000)
            },
            { upsert: true, returnDocument: 'after' }
        );

        return res.status(200).json({ success: true, source: 'google_places', data: hotels });

    } catch (err) {
        console.error("[Google Hotels] Error:", err.message);
        // Fallback gracefully
        return exports.getHotels(req, res);
    }
};

module.exports = exports;
