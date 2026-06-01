const axios = require('axios');
const NodeCache = require('node-cache');
const NearbyPlaceCache = require('../models/NearbyPlaceCache');
const { callGemini } = require('../utils/geminiClient');
const placeController = require('./placeController');

// In-memory cache: city search results valid for 30 minutes
if (!global.citySearchCache) global.citySearchCache = new NodeCache({ stdTTL: 1800 });
const citySearchCache = global.citySearchCache;

// ─────────────────────────────────────────────────────────────────────────────
// City coordinate map (used to resolve city name → lat/lng for Google Places)
// ─────────────────────────────────────────────────────────────────────────────
const CITY_COORDS = {
    'cairo':          { lat: 30.0444, lng: 31.2357 },
    'alexandria':     { lat: 31.2001, lng: 29.9187 },
    'hurghada':       { lat: 27.2579, lng: 33.8116 },
    'luxor':          { lat: 25.6872, lng: 32.6396 },
    'sharm el-sheikh':{ lat: 27.9158, lng: 34.3299 },
    'sharm':          { lat: 27.9158, lng: 34.3299 },
    'aswan':          { lat: 24.0889, lng: 32.8998 },
    'dahab':          { lat: 28.4956, lng: 34.5133 },
    'fayoum':         { lat: 29.3084, lng: 30.8428 },
    'dubai':          { lat: 25.2048, lng: 55.2708 },
};

const resolveCityCoords = (cityName) => {
    const key = cityName.toLowerCase().trim();
    return CITY_COORDS[key] || CITY_COORDS['cairo']; // fallback to Cairo
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Fetch one category from Google Places Text Search API
// Uses the city name as a text query (no lat/lng restriction needed)
// ─────────────────────────────────────────────────────────────────────────────
const fetchCategoryForCity = async (city, categoryLabel, googleTypes) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey.length < 10) {
        console.warn(`[City Search] Google API key missing — skipping live fetch for ${categoryLabel}`);
        return [];
    }

    try {
        const coords = resolveCityCoords(city);
        const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                includedTypes: googleTypes,
                maxResultCount: 10,
                locationRestriction: {
                    circle: {
                        center: { latitude: coords.lat, longitude: coords.lng },
                        radius: 50000  // 50km radius covers entire city regions
                    }
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.googleMapsUri'
                },
                timeout: 8000
            }
        );

        const places = response.data.places || [];
        console.log(`✅ [City Search] ${categoryLabel} in ${city}: ${places.length} results`);

        return places.map(p => ({
            id: p.id,
            name: p.displayName?.text || 'Unknown Place',
            address: p.formattedAddress || city,
            city,
            rating: p.rating || 4.0,
            reviewCount: p.userRatingCount || 0,
            category: categoryLabel,
            price: _estimatePrice(categoryLabel),
            imageUrl: _getImage(categoryLabel),
            location: { latitude: p.location?.latitude, longitude: p.location?.longitude },
            mapUri: p.googleMapsUri || null,
            source: 'google_places'
        }));
    } catch (err) {
        console.warn(`[City Search] Google fetch failed for ${categoryLabel}: ${err.message}`);
        return [];
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: MongoDB cache lookup (city-based filter on NearbyPlaceCache items)
// Used as Tier 2 when Google Places fails or is slow
// ─────────────────────────────────────────────────────────────────────────────
const fetchFromMongoCache = async (city) => {
    try {
        // Sanitize input before using in regex (prevent ReDoS)
        const sanitized = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cityRegex = new RegExp(sanitized, 'i');

        // Try direct city match on cache documents
        const caches = await NearbyPlaceCache.find({ city: cityRegex }).lean();

        if (caches.length > 0) {
            const items = caches.flatMap(c => c.items || []);
            console.log(`💾 [City Search] MongoDB cache hit for "${city}": ${items.length} items`);
            return items.map(item => ({ ...item, city, source: 'mongo_cache' }));
        }

        // Also try scanning all cache items' address fields for the city name
        const allCaches = await NearbyPlaceCache.find({}).lean();
        const matched = [];
        for (const cache of allCaches) {
            const cityItems = (cache.items || []).filter(item =>
                (item.address || '').match(cityRegex) ||
                (item.name || '').match(cityRegex)
            );
            matched.push(...cityItems.map(item => ({ ...item, city, source: 'mongo_cache' })));
        }

        if (matched.length > 0) {
            console.log(`💾 [City Search] MongoDB address scan found ${matched.length} items for "${city}"`);
        }
        return matched;
    } catch (err) {
        console.warn(`[City Search] MongoDB cache lookup failed: ${err.message}`);
        return [];
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Hardcoded fallback data per city
// ─────────────────────────────────────────────────────────────────────────────
const _hardcodedFallback = (city) => {
    const c = city.toLowerCase();
    const base = (items) => items.map((item, i) => ({ ...item, id: `hc_${i}`, city, source: 'hardcoded', price: item.price || 150 }));

    if (c.includes('hurghada')) return base([
        { name: 'Hurghada Grand Aquarium', category: 'activity', rating: 4.6, address: 'El Sahl, Hurghada', imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600' },
        { name: 'Sindbad Beach Resort', category: 'hotel', rating: 4.5, address: 'Hurghada', imageUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', price: 1200 },
        { name: 'Sharm El Naga Reef', category: 'activity', rating: 4.8, address: 'North Safaga, Hurghada', imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600' },
        { name: 'Fisherman\'s Harbour Restaurant', category: 'restaurant', rating: 4.3, address: 'Old Town, Hurghada', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600' },
    ]);
    if (c.includes('sharm')) return base([
        { name: 'Ras Mohammed National Park', category: 'activity', rating: 4.9, address: 'Sharm El-Sheikh', imageUrl: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600' },
        { name: 'Naama Bay Beach', category: 'activity', rating: 4.7, address: 'Naama Bay, Sharm', imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600' },
        { name: 'Baron Resort Sharm El Sheikh', category: 'hotel', rating: 4.4, address: 'Naama Bay, Sharm', imageUrl: 'https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=600', price: 1500 },
        { name: 'Koshary Corner', category: 'restaurant', rating: 4.2, address: 'Sharm El-Sheikh', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600' },
    ]);
    if (c.includes('luxor')) return base([
        { name: 'Karnak Temple', category: 'activity', rating: 4.9, address: 'Karnak, Luxor', imageUrl: 'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600' },
        { name: 'Valley of the Kings', category: 'activity', rating: 4.8, address: 'West Bank, Luxor', imageUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600' },
        { name: 'Steigenberger Nile Palace', category: 'hotel', rating: 4.7, address: 'Luxor', imageUrl: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=600', price: 3500 },
        { name: 'Sofra Restaurant & Cafe', category: 'restaurant', rating: 4.5, address: 'Mohamed Farid St, Luxor', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600' },
    ]);
    // Default: Cairo
    return base([
        { name: 'The Great Pyramids of Giza', category: 'activity', rating: 4.9, address: 'Giza, Cairo', imageUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600' },
        { name: 'Egyptian Museum', category: 'activity', rating: 4.7, address: 'Tahrir Square, Cairo', imageUrl: 'https://images.unsplash.com/photo-1518998053574-53ee81eb6449?w=600' },
        { name: 'Four Seasons Nile Plaza', category: 'hotel', rating: 4.9, address: 'Nile Plaza, Cairo', imageUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', price: 2500 },
        { name: 'Koshary Abou Tarek', category: 'restaurant', rating: 4.8, address: 'Champollion, Cairo', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600' },
    ]);
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: UnifiedCitySearch — queries all categories via Promise.all
// GET /api/ai/city-search?city=Hurghada&budget=5000
// ─────────────────────────────────────────────────────────────────────────────
exports.citySearch = async (req, res) => {
    const city = (req.query.city || req.body.city || 'Cairo').trim();
    const budget = parseFloat(req.query.budget || req.body.budget || 0);

    console.log(`\n[City Search] ─── city: "${city}" | budget: ${budget} EGP ───`);

    // In-memory cache key
    const cacheKey = `city_${city.toLowerCase()}_${Math.floor(budget / 1000)}k`;
    const cached = citySearchCache.get(cacheKey);
    if (cached) {
        console.log(`⚡ [City Search] Memory cache HIT for "${city}"`);
        return res.status(200).json({ success: true, source: 'cache', city, ...cached });
    }

    try {
        // ── Tier 1: Google Places API — Unified search via Promise.all ─────────
        let hotels = [];
        const mockRes = { status: () => ({ json: (d) => { if (d.success) hotels = d.data || []; } }) };

        const [restaurants, activities, cafes, beaches, _] = await Promise.all([
            fetchCategoryForCity(city, 'restaurant', ['restaurant', 'food']),
            fetchCategoryForCity(city, 'activity',   ['tourist_attraction', 'museum', 'amusement_park', 'park']),
            fetchCategoryForCity(city, 'cafe',        ['cafe', 'coffee_shop', 'bakery']),
            fetchCategoryForCity(city, 'beach',       ['beach', 'natural_feature']),
            placeController.getHotelsByCity({ query: { city } }, mockRes) // Fetch hotels in parallel
        ]);

        let allPlaces = [...restaurants, ...activities, ...cafes, ...beaches];
        let dataSource = 'google_places';

        // ── Tier 2: MongoDB cache if Google returned nothing ──────────────────
        if (allPlaces.length === 0) {
            console.warn(`[City Search] Google returned 0 results. Falling back to MongoDB cache.`);
            allPlaces = await fetchFromMongoCache(city);
            dataSource = 'mongo_cache';
        }

        // ── Tier 3: Hardcoded fallback ────────────────────────────────────────
        if (allPlaces.length === 0) {
            console.warn(`[City Search] All sources empty. Using hardcoded fallback for "${city}".`);
            allPlaces = _hardcodedFallback(city);
            dataSource = 'hardcoded';
        }

        // ── Budget filter (Wallet-Aware): if budget provided, prioritize affordable items ──
        let filteredPlaces = allPlaces;
        if (budget > 0) {
            const affordable = allPlaces.filter(p => !p.price || p.price <= budget);
            filteredPlaces = affordable.length > 0 ? affordable : allPlaces;
            console.log(`[City Search] Budget filter (≤ ${budget} EGP): ${filteredPlaces.length}/${allPlaces.length} places qualify`);
        }

        // Sort by rating descending
        filteredPlaces.sort((a, b) => (b.rating || 0) - (a.rating || 0));

        // Group by category for structured response
        const grouped = {
            restaurants: filteredPlaces.filter(p => p.category === 'restaurant'),
            activities:  filteredPlaces.filter(p => p.category === 'activity' || p.category === 'attraction'),
            cafes:       filteredPlaces.filter(p => p.category === 'cafe'),
            beaches:     filteredPlaces.filter(p => p.category === 'beach'),
            hotels:      hotels, // Include the fetched hotels
            all:         filteredPlaces,
        };

        // Optional AI intro
        let aiIntro = `اكتشف أجمل ما يقدمه ${city}! 🌟`;
        try {
            const prompt = `Write a warm 1-sentence travel intro for "${city}", Egypt. Plain text only, max 20 words.`;
            const aiResult = await callGemini(prompt);
            if (aiResult.ok) aiIntro = aiResult.text;
        } catch (_) { /* non-critical */ }

        const payload = { totalCount: filteredPlaces.length, dataSource, aiIntro, grouped };

        // Cache result in memory
        citySearchCache.set(cacheKey, payload);

        console.log(`[City Search] ✅ Done — ${filteredPlaces.length} places | source: ${dataSource}\n`);
        return res.status(200).json({ success: true, city, ...payload });

    } catch (err) {
        console.error('[City Search] CRASH:', err.message);
        const fallback = _hardcodedFallback(city);
        return res.status(200).json({
            success: true, city,
            totalCount: fallback.length,
            dataSource: 'hardcoded_error_recovery',
            aiIntro: `اكتشف ${city}! 🌟`,
            grouped: { all: fallback, restaurants: [], activities: fallback, cafes: [], beaches: [] }
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// NEW: CityExplorer — 50km radius unified discovery
// GET /api/ai/city-explorer?city=Sharm
// ─────────────────────────────────────────────────────────────────────────────
exports.cityExplorer = async (req, res) => {
    const cityName = (req.query.city || 'Cairo').trim();
    const cityKey = cityName.toLowerCase().replace(/\s+/g, '_');
    console.log(`[City Explorer] 🗺️ Discovery for ${cityName} within 50km...`);

    try {
        // 1. Check Cache for all 4 categories
        const categories = ['lodging', 'restaurant', 'cafe', 'tourist_attraction'];
        const cacheEntries = await Promise.all(
            categories.map(type => NearbyPlaceCache.findOne({ queryKey: `explorer_${cityKey}_${type}` }))
        );

        if (cacheEntries.every(c => c && c.items && c.items.length > 0)) {
            console.log(`⚡ [City Explorer] Full Cache HIT for ${cityName}`);
            return res.status(200).json({
                success: true,
                city: cityName,
                center: cacheEntries[0].center,
                radius: 50000,
                grouped: {
                    hotels:      cacheEntries[0].items,
                    restaurants: cacheEntries[1].items,
                    cafes:       cacheEntries[2].items,
                    activities:  cacheEntries[3].items
                }
            });
        }

        // 2. Geocode City
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cityName)}&key=${apiKey}`;
        const geoRes = await axios.get(geoUrl);
        
        if (!geoRes.data.results || geoRes.data.results.length === 0) {
            return res.status(404).json({ success: false, message: "City not found" });
        }

        const center = geoRes.data.results[0].geometry.location;
        const lat = center.lat;
        const lng = center.lng;

        // 3. Parallel Google Places Search (radius 50km)
        const [hotels, restaurants, cafes, activities] = await Promise.all([
            _fetchExplorerCategory(lat, lng, 50000, ['lodging'], 'lodging'),
            _fetchExplorerCategory(lat, lng, 50000, ['restaurant'], 'restaurant'),
            _fetchExplorerCategory(lat, lng, 50000, ['cafe'], 'cafe'),
            _fetchExplorerCategory(lat, lng, 50000, ['tourist_attraction'], 'tourist_attraction')
        ]);

        // 4. Cache results per category (TTL 2 hours)
        const dataMap = { lodging: hotels, restaurant: restaurants, cafe: cafes, tourist_attraction: activities };
        
        await Promise.all(categories.map(type => {
            const items = dataMap[type];
            return NearbyPlaceCache.findOneAndUpdate(
                { queryKey: `explorer_${cityKey}_${type}` },
                {
                    queryKey: `explorer_${cityKey}_${type}`,
                    city: cityName,
                    center: { type: 'Point', coordinates: [lng, lat] },
                    items: items,
                    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 Hours
                },
                { upsert: true }
            );
        }));

        console.log(`✅ [City Explorer] Discovery complete for ${cityName}. Cached 4 categories.`);

        return res.status(200).json({
            success: true,
            city: cityName,
            center: { lat, lng },
            radius: 50000,
            grouped: { hotels, restaurants, cafes, activities }
        });

    } catch (err) {
        console.error(`[City Explorer] CRASH for ${cityName}:`, err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

const _fetchExplorerCategory = async (lat, lng, radius, types, categoryLabel) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    try {
        const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                includedTypes: types,
                maxResultCount: 20,
                locationRestriction: {
                    circle: {
                        center: { latitude: lat, longitude: lng },
                        radius: radius
                    }
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos'
                },
                timeout: 12000
            }
        );

        const places = response.data.places || [];
        return places.map(p => {
            let imageUrl = 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600';
            if (p.photos && p.photos.length > 0) {
                const photoReference = p.photos[0].name;
                imageUrl = `https://places.googleapis.com/v1/${photoReference}/media?maxHeightPx=400&maxWidthPx=400&key=${apiKey}`;
            }

            return {
                id: p.id,
                name: p.displayName?.text || 'Unknown',
                rating: p.rating || 4.0,
                price: 150,
                imageUrl: imageUrl,
                address: p.formattedAddress || '',
                lat: p.location?.latitude,
                lng: p.location?.longitude,
                type: categoryLabel
            };
        });
    } catch (err) {
        console.warn(`[City Explorer] Google fetch failed for ${categoryLabel}: ${err.message}`);
        return [];
    }
};

// ── Private helpers ───────────────────────────────────────────────────────────
function _estimatePrice(category) {
    const prices = { restaurant: 150, cafe: 80, activity: 200, beach: 0, hotel: 1200, attraction: 100 };
    return prices[category] || 100;
}

function _getImage(category) {
    const images = {
        restaurant: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
        cafe:       'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600',
        activity:   'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600',
        beach:      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600',
        hotel:      'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600',
        attraction: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600',
    };
    return images[category] || images.attraction;
}
