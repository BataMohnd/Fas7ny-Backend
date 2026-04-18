const axios = require('axios');
const mongoose = require('mongoose');
const Hotel = require('../models/HotelModel');
const Place = require('../models/Place'); // Added Place model reference
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
            console.log('Raw API Response:', JSON.stringify(response.data, null, 2));

            // Support multiple response shapes from Booking.com RapidAPI
            const rawData =
                response.data?.result ||
                response.data?.data?.results ||
                response.data?.data ||
                (Array.isArray(response.data) ? response.data : []);

            console.log(`📦 Extracted ${rawData.length} hotels from API`);

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
                rating: (h.review_score || h.reviewScore || 4.5), // Maps to rating or default
                image: h.main_photo_url || h.mainPhotoUrl, // Explicitly map to image
                reviewCount: (h.review_nr || h.reviewCount || 0)
            }));
            console.log("✅ RapidAPI Success (Dynamic)");
        } catch (apiError) {
            console.warn("⚠️ RapidAPI Failed, trying MongoDB...");
            source = 'mongodb';
            const dbHotels = await Hotel.find({ cityId: cityId });

            if (dbHotels.length > 0) {
                hotels = dbHotels.map(h => ({
                    hotelId: h.hotelId,
                    hotelName: h.hotelName,
                    mainPhotoUrl: h.mainPhotoUrl || h.image_url,
                    image: h.image_url || h.mainPhotoUrl, // Added for UI sync request
                    address: h.address,
                    price: req.formatPrice ? req.formatPrice(h.price || 500) : h.price,
                    currency: req.userCurrency || 'EGP', // Dynamic injection
                    rating: 4.5, // Default as requested
                    reviewCount: h.reviewCount || 0
                }));
                console.log("✅ Dynamic Injection Success");
            } else {
                console.warn("⚠️ MongoDB Empty, falling back to Static Data...");
                source = 'static';
                hotels = staticFallbackData.map(h => ({
                    ...h,
                    price: req.formatPrice ? req.formatPrice(h.price) : h.price,
                    currency: req.userCurrency || 'EGP'
                }));
            }
        }

        console.log(`✅ Success from ${source}`);
        res.status(200).json({ success: true, source, data: hotels });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
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

// 2. البحث عن الأماكن (Universal Fallback)
exports.searchPlaces = async (req, res) => {
    try {
        const query = req.query.name;
        if (!query) return res.status(200).json({ success: true, data: [] });

        const regex = { $regex: query, $options: 'i' };

        // Search Hotels: hotelName, address, city, room_type, description
        const hotelsRaw = await Hotel.find({
            $or: [
                { hotelName: regex },
                { address: regex },
                { city: regex },
                { room_type: regex },
                { description: regex }
            ]
        }).limit(20);

        // Search Places: name, neighbourhood, category, description
        const placesRaw = await Place.find({
            $or: [
                { name: regex },
                { neighbourhood: regex },
                { category: regex },
                { description: regex }
            ]
        }).limit(20);

        // Scoring Function for Relevance
        const scoreMatch = (item, q) => {
            const name = (item.hotelName || item.name || "").toLowerCase();
            const qLow = q.toLowerCase();
            if (name === qLow) return 100;
            if (name.startsWith(qLow)) return 80;
            if (name.includes(qLow)) return 60;
            return 40; // Location or description match
        };

        // Sync Hotels with injection
        const hotels = hotelsRaw.map(h => ({
            hotelId: h.hotelId,
            hotelName: h.hotelName,
            mainPhotoUrl: h.mainPhotoUrl || h.image_url,
            image: h.image_url || h.mainPhotoUrl,
            address: h.address,
            price: req.formatPrice ? req.formatPrice(h.price || 500) : h.price,
            currency: req.userCurrency || 'EGP',
            rating: 4.5,
            reviewCount: h.reviewCount || 0,
            source: 'mongo',
            relevanceScore: scoreMatch(h, query)
        }));

        // Sync Places with injection
        const places = placesRaw.map(p => ({
            id: p._id,
            name: p.name,
            imageUrl: p.imageUrl,
            price: p.price,
            neighbourhood: p.neighbourhood,
            currency: req.userCurrency || 'EGP',
            rating: 4.5,
            numberOfReviews: p.numberOfReviews || 0,
            description: p.description,
            source: 'mongo',
            relevanceScore: scoreMatch(p, query)
        }));

        // Combine and limit total results to 20 for top performance, sorted by relevance
        let combinedResults = [...places, ...hotels]
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 20);

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

        let numericLat = parseFloat(lat);
        let numericLng = parseFloat(lng);

        // -- STEP 0: Smart Location Handler (Alexandria Bridge) --
        if (isNaN(numericLat) || isNaN(numericLng)) {
            const cityMap = {
                '-3712125': { lat: 30.0444, lng: 31.2357 }, // Cairo
                '-3712078': { lat: 31.2001, lng: 29.9187 }, // Alexandria
                '8': { lat: 25.2048, lng: 55.2708 }          // Dubai
            };
            const cityId = req.query.cityId || '-3712125';
            const coords = cityMap[cityId] || cityMap['-3712125'];
            numericLat = coords.lat;
            numericLng = coords.lng;
            console.log(`📍 NN Intelligence: Defaulting to ${cityId === '-3712078' ? 'Alexandria' : 'Cairo'} coordinates [${numericLat}, ${numericLng}]`);
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
        console.log("⚠️ NN Cache Miss! Fetching live from Serper API...");
        const serperKey = process.env.SERPER_API_KEY;
        if (!serperKey) {
            return res.status(200).json({ data: [] }); // Disable gracefully if no key
        }

        const serperRes = await axios.post('https://google.serper.dev/places', {
            q: `Cafes and restaurants near ${numericLat}, ${numericLng}`,
            location: `${numericLat},${numericLng}`
        }, {
            headers: {
                'X-API-KEY': serperKey,
                'Content-Type': 'application/json'
            }
        });

        const rawPlaces = serperRes.data?.places || [];
        
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
