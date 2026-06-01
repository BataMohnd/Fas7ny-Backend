const axios = require('axios');
const NodeCache = require('node-cache');
const NearbyPlaceCache = require('../models/NearbyPlaceCache');
const placeController = require('./placeController');
const UserPlace = require('../models/UserPlace');

// In-memory cache: city search results valid for 30 minutes
if (!global.citySearchCache) global.citySearchCache = new NodeCache({ stdTTL: 1800 });
const citySearchCache = global.citySearchCache;

/**
 * Pure Algorithm-based Value Score Ranking
 */
function calcValueScore(place, userPreferences = [], userBudgetPerDay = 0) {
  const rating = place.rating || 4.0;
  const price = place.price || place.estimatedCost || 100;
  const maxPrice = 5000;

  // Base score: 60% rating + 40% price efficiency
  const ratingScore = (rating / 5.0) * 60;
  const priceScore = (1 - Math.min(price / maxPrice, 1)) * 40;
  let score = ratingScore + priceScore;

  // Bonus: +15 if matches user preferences
  if (userPreferences.length > 0) {
    const placeText = `${place.name} ${place.category || ''} ${place.type || ''} ${place.address || ''}`.toLowerCase();
    const prefMatch = userPreferences.some(pref =>
      placeText.includes(pref.toLowerCase())
    );
    if (prefMatch) score += 15;
  }

  // Bonus: +10 if within budget
  if (userBudgetPerDay > 0 && price <= userBudgetPerDay) score += 10;

  // Bonus: +5 if highly rated (4.5+)
  if (rating >= 4.5) score += 5;

  return Math.round(score * 10) / 10;
}

// City coordinate map
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
    return CITY_COORDS[key] || CITY_COORDS['cairo'];
};

// Google Places API v1 — getPlace with all fields
const getPlaceDetails = async (placeId) => {
  try {
    const response = await axios.get(
      `https://places.googleapis.com/v1/places/${placeId}`,
      {
        headers: {
          'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': [
            'id', 'displayName', 'formattedAddress',
            'rating', 'userRatingCount',
            'priceLevel',
            'currentOpeningHours',
            'photos',
            'editorialSummary',
            'regularOpeningHours',
            'internationalPhoneNumber',
            'websiteUri',
            'location',
            'types',
          ].join(','),
        },
      }
    );
    return response.data;
  } catch (err) {
    return null;
  }
};

// Convert Google priceLevel to EGP estimate
function priceLevelToEGP(priceLevel, type) {
  const priceMap = {
    'restaurant': {
      'PRICE_LEVEL_FREE':          0,
      'PRICE_LEVEL_INEXPENSIVE':   80,
      'PRICE_LEVEL_MODERATE':      200,
      'PRICE_LEVEL_EXPENSIVE':     450,
      'PRICE_LEVEL_VERY_EXPENSIVE':900,
    },
    'cafe': {
      'PRICE_LEVEL_FREE':          0,
      'PRICE_LEVEL_INEXPENSIVE':   50,
      'PRICE_LEVEL_MODERATE':      120,
      'PRICE_LEVEL_EXPENSIVE':     250,
      'PRICE_LEVEL_VERY_EXPENSIVE':500,
    },
    'hotel': {
      'PRICE_LEVEL_FREE':          0,
      'PRICE_LEVEL_INEXPENSIVE':   500,
      'PRICE_LEVEL_MODERATE':      1200,
      'PRICE_LEVEL_EXPENSIVE':     2500,
      'PRICE_LEVEL_VERY_EXPENSIVE':5000,
    },
    'activity': {
      'PRICE_LEVEL_FREE':          0,
      'PRICE_LEVEL_INEXPENSIVE':   50,
      'PRICE_LEVEL_MODERATE':      150,
      'PRICE_LEVEL_EXPENSIVE':     350,
      'PRICE_LEVEL_VERY_EXPENSIVE':700,
    },
  };
  const category = priceMap[type] || priceMap['activity'];
  return category[priceLevel] ?? category['PRICE_LEVEL_MODERATE'];
}

// Build real photo URL from Google Places photo reference
function buildPhotoUrl(photoName, maxWidth = 800) {
  if (!photoName) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
}

// Normalize a Google Place to our format
function normalizeGooglePlace(place, type, cityName) {
  const priceLevel = place.priceLevel || 'PRICE_LEVEL_MODERATE';
  const price      = priceLevelToEGP(priceLevel, type);

  // Get first real photo
  const photos    = place.photos || [];
  const photoName = photos[0]?.name;
  const imageUrl  = photoName
    ? buildPhotoUrl(photoName, 800)
    : _cityFallbackImage(cityName);

  // Menu hint from opening hours and summary
  const summary = place.editorialSummary?.text || null;
  const hasMenu = ['restaurant', 'cafe', 'bakery', 'bar'].includes(type);
  const menuNote = hasMenu
    ? (price > 0
        ? `Typical spend: ~${price} EGP per person`
        : 'Menu pricing varies — contact the venue for current prices')
    : null;

  return {
    id:          place.id,
    name:        place.displayName?.text || 'Unknown',
    address:     place.formattedAddress  || cityName,
    rating:      place.rating            || 4.0,
    reviewCount: place.userRatingCount   || 0,
    price,
    priceLevel,
    currency:    'EGP',
    imageUrl,
    allPhotos:   photos.slice(0, 5).map(p => buildPhotoUrl(p.name, 600)),
    type,
    category:    type,
    city:        cityName,
    description: summary,
    menuNote,
    phone:       place.internationalPhoneNumber || null,
    website:     place.websiteUri || null,
    lat:         place.location?.latitude,
    lng:         place.location?.longitude,
    isOpenNow:   place.currentOpeningHours?.openNow ?? null,
    source:      'google_places',
  };
}

function _cityFallbackImage(city) {
  const map = {
    'Cairo':          'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=800',
    'Luxor':          'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=800',
    'Hurghada':       'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800',
    'Aswan':          'https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=800',
    'Sharm El-Sheikh':'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800',
    'Alexandria':     'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800',
    'Dahab':          'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=800',
  };
  return map[city] || map['Cairo'];
}

const fetchCategoryForCity = async (city, categoryLabel, googleTypes) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || apiKey.length < 10) return [];

    try {
        const coords = resolveCityCoords(city);
        const response = await axios.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                includedTypes: googleTypes,
                maxResultCount: 15,
                locationRestriction: {
                    circle: {
                        center: { latitude: coords.lat, longitude: coords.lng },
                        radius: 50000
                    }
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.googleMapsUri,places.priceLevel,places.currentOpeningHours,places.photos,places.editorialSummary,places.regularOpeningHours,places.internationalPhoneNumber,places.websiteUri'
                },
                timeout: 8000
            }
        );

        const places = response.data.places || [];
        return places.map(p => normalizeGooglePlace(p, categoryLabel, city));
    } catch (err) {
        return [];
    }
};

const fetchFromMongoCache = async (city) => {
    try {
        const sanitized = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cityRegex = new RegExp(sanitized, 'i');
        const caches = await NearbyPlaceCache.find({ city: cityRegex }).lean();
        if (caches.length > 0) {
            const items = caches.flatMap(c => c.items || []);
            return items.map(item => ({ ...item, city, source: 'mongo_cache' }));
        }
        return [];
    } catch (err) {
        return [];
    }
};

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
    return base([
        { name: 'The Great Pyramids of Giza', category: 'activity', rating: 4.9, address: 'Giza, Cairo', imageUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600' },
        { name: 'Egyptian Museum', category: 'activity', rating: 4.7, address: 'Tahrir Square, Cairo', imageUrl: 'https://images.unsplash.com/photo-1518998053574-53ee81eb6449?w=600' },
        { name: 'Four Seasons Nile Plaza', category: 'hotel', rating: 4.9, address: 'Nile Plaza, Cairo', imageUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600', price: 2500 },
        { name: 'Koshary Abou Tarek', category: 'restaurant', rating: 4.8, address: 'Champollion, Cairo', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600' },
    ]);
};

// GET /api/ai/city-search
exports.citySearch = async (req, res) => {
    const city = (req.query.city || req.body.city || 'Cairo').trim();
    const budget = parseFloat(req.query.budget || req.body.budget || 0);

    const cacheKey = `city_${city.toLowerCase()}_${Math.floor(budget / 1000)}k`;
    const cached = citySearchCache.get(cacheKey);
    if (cached) return res.status(200).json({ success: true, city, ...cached });

    try {
        let hotels = [];
        const mockRes = { status: () => ({ json: (d) => { if (d.success) hotels = d.data || []; } }) };

        const [restaurants, activities, cafes, beaches] = await Promise.all([
            fetchCategoryForCity(city, 'restaurant', ['restaurant', 'food']),
            fetchCategoryForCity(city, 'activity',   ['tourist_attraction', 'museum', 'amusement_park', 'park']),
            fetchCategoryForCity(city, 'cafe',        ['cafe', 'coffee_shop', 'bakery']),
            fetchCategoryForCity(city, 'beach',       ['beach', 'natural_feature']),
            placeController.getHotelsByCity({ query: { city } }, mockRes)
        ]);

        let allPlaces = [...restaurants, ...activities, ...cafes, ...beaches];
        if (allPlaces.length === 0) allPlaces = await fetchFromMongoCache(city);
        if (allPlaces.length === 0) allPlaces = _hardcodedFallback(city);

        // RANKING ALGORITHM
        console.log(`[Algorithm] Scoring ${allPlaces.length} places for ${city}...`);
        const score = (p) => calcValueScore(p, [], budget);
        const addScore = (p) => ({
            ...p,
            valueScore: score(p),
            scoreBadge: score(p) >= 80 ? '🥇' : score(p) >= 65 ? '🥈' : '🥉'
        });

        const rankedAll = allPlaces.map(addScore).sort((a,b) => b.valueScore - a.valueScore);

        // ── Community places: fetch & merge after Google results ──────────────
        const sanitizedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const userPlaces = await UserPlace.find({
            status: 'approved',
            isActive: true,
            $or: [
                { city:    { $regex: new RegExp(sanitizedCity, 'i') } },
                { address: { $regex: new RegExp(sanitizedCity, 'i') } },
            ]
        }).lean();
        console.log(`[UserPlace] Found ${userPlaces.length} community places for ${city}`);

        const normalizeUserPlace = (p) => ({
            id:          p._id.toString(),
            name:        p.name,
            imageUrl:    p.mainPhoto || p.photos?.[0] || 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600',
            address:     p.address || p.city || city,
            rating:      p.rating || 4.0,
            price:       p.price || 0,
            lat:         p.lat,
            lng:         p.lng,
            category:    p.category || 'activity',
            type:        p.category || 'activity',
            city,
            source:      'community',
            ownerPhone:  p.ownerPhone,
            isUserAdded: true,
        });

        const uHotels      = userPlaces.filter(p => p.category === 'hotel').map(normalizeUserPlace);
        const uRestaurants = userPlaces.filter(p => p.category === 'restaurant').map(normalizeUserPlace);
        const uCafes       = userPlaces.filter(p => p.category === 'cafe').map(normalizeUserPlace);
        const uActivities  = userPlaces.filter(p => ['activity','other'].includes(p.category)).map(normalizeUserPlace);

        const googleHotels = hotels.map(addScore).sort((a,b) => b.valueScore - a.valueScore);
        const grouped = {
            restaurants: [...rankedAll.filter(p => p.category === 'restaurant'), ...uRestaurants.map(addScore)],
            activities:  [...rankedAll.filter(p => p.category === 'activity' || p.category === 'attraction'), ...uActivities.map(addScore)],
            cafes:       [...rankedAll.filter(p => p.category === 'cafe'), ...uCafes.map(addScore)],
            hotels:      [...googleHotels, ...uHotels.map(addScore)],
            all:         [...rankedAll, ...userPlaces.map(normalizeUserPlace).map(addScore)],
        };

        const payload = { 
            totalCount: rankedAll.length + userPlaces.length,
            communityCount: userPlaces.length,
            algorithm: 'value_score_v2',
            aiIntro: `اكتشف أجمل ما يقدمه ${city}! 🌟`, 
            grouped 
        };
        citySearchCache.set(cacheKey, payload);
        return res.status(200).json({ success: true, city, ...payload });

    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

// GET /api/ai/city-explorer
exports.cityExplorer = async (req, res) => {
    const cityName = (req.query.city || 'Cairo').trim();
    const cityKey = cityName.toLowerCase().replace(/\s+/g, '_');

    try {
        const categories = ['lodging', 'restaurant', 'cafe', 'tourist_attraction'];
        const cacheEntries = await Promise.all(
            categories.map(type => NearbyPlaceCache.findOne({ queryKey: `explorer_${cityKey}_${type}` }))
        );

        let data = { hotels: [], restaurants: [], cafes: [], activities: [] };
        let center = null;

        if (cacheEntries.every(c => c && c.items && c.items.length > 0)) {
            data = {
                hotels:      cacheEntries[0].items,
                restaurants: cacheEntries[1].items,
                cafes:       cacheEntries[2].items,
                activities:  cacheEntries[3].items
            };
            center = cacheEntries[0].center;
        } else {
            const apiKey = process.env.GOOGLE_MAPS_API_KEY;
            const geoRes = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cityName)}&key=${apiKey}`);
            if (!geoRes.data.results || geoRes.data.results.length === 0) return res.status(404).json({ success: false, message: "City not found" });
            
            const loc = geoRes.data.results[0].geometry.location;
            center = { lat: loc.lat, lng: loc.lng };

            const results = await Promise.all([
                _fetchExplorerCategory(loc.lat, loc.lng, 50000, ['lodging'], 'hotel', cityName),
                _fetchExplorerCategory(loc.lat, loc.lng, 50000, ['restaurant'], 'restaurant', cityName),
                _fetchExplorerCategory(loc.lat, loc.lng, 50000, ['cafe'], 'cafe', cityName),
                _fetchExplorerCategory(loc.lat, loc.lng, 50000, ['tourist_attraction'], 'activity', cityName)
            ]);

            data = { hotels: results[0], restaurants: results[1], cafes: results[2], activities: results[3] };

            // Normalize helper
            const normalizePlace = (place) => ({
                id: place.id || place.placeId || `place_${Date.now()}_${Math.random()}`,
                name: place.name || place.displayName?.text || 'Unknown',
                imageUrl: place.imageUrl || '',
                address: place.address || place.formattedAddress || '',
                rating: place.rating || 4.0,
                price: place.price || 150,
                lat: place.lat || place.location?.latitude,
                lng: place.lng || place.location?.longitude,
                type: place.type || 'activity',
                city: cityName,
            });

            // Save ALL places to cache with normalized format
            const allNormalized = [
                ...data.hotels.map(normalizePlace),
                ...data.restaurants.map(normalizePlace),
                ...data.cafes.map(normalizePlace),
                ...data.activities.map(normalizePlace),
            ];

            // Cache in chunks by category
            await Promise.all(categories.map((type, i) => {
                const items = Object.values(data)[i].map(normalizePlace);
                return NearbyPlaceCache.findOneAndUpdate(
                    { queryKey: `explorer_${cityKey}_${type}` },
                    { 
                        queryKey: `explorer_${cityKey}_${type}`, 
                        city: cityName, 
                        center: { type: 'Point', coordinates: [loc.lng, loc.lat] }, 
                        items, 
                        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) 
                    },
                    { upsert: true }
                );
            }));
        }

        // RANKING ALGORITHM
        console.log(`[Algorithm] Ranking explorer results for ${cityName}...`);
        const score = (p) => calcValueScore(p, [], 0);
        const addScore = (p) => ({
            ...p,
            valueScore: score(p),
            scoreBadge: score(p) >= 80 ? '🥇' : score(p) >= 65 ? '🥈' : '🥉'
        });

        // ── Community places: fetch & merge after Google results ──────────────
        const sanitizedCityName = cityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const userPlaces = await UserPlace.find({
            status: 'approved',
            isActive: true,
            $or: [
                { city:    { $regex: new RegExp(sanitizedCityName, 'i') } },
                { address: { $regex: new RegExp(sanitizedCityName, 'i') } },
            ]
        }).lean();
        console.log(`[UserPlace] Found ${userPlaces.length} community places for ${cityName}`);

        const normalizeUserPlace = (p) => ({
            id:          p._id.toString(),
            name:        p.name,
            imageUrl:    p.mainPhoto || p.photos?.[0] || 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600',
            address:     p.address || p.city || cityName,
            rating:      p.rating || 4.0,
            price:       p.price || 0,
            lat:         p.lat,
            lng:         p.lng,
            category:    p.category || 'activity',
            type:        p.category || 'activity',
            city:        cityName,
            source:      'community',
            ownerPhone:  p.ownerPhone,
            isUserAdded: true,
        });

        const uHotels      = userPlaces.filter(p => p.category === 'hotel').map(normalizeUserPlace).map(addScore);
        const uRestaurants = userPlaces.filter(p => p.category === 'restaurant').map(normalizeUserPlace).map(addScore);
        const uCafes       = userPlaces.filter(p => p.category === 'cafe').map(normalizeUserPlace).map(addScore);
        const uActivities  = userPlaces.filter(p => ['activity','other'].includes(p.category)).map(normalizeUserPlace).map(addScore);

        return res.status(200).json({
            success: true,
            city: cityName,
            center,
            algorithm: 'value_score_v2',
            communityCount: userPlaces.length,
            grouped: {
                hotels:      [...data.hotels.map(addScore).sort((a,b) => b.valueScore - a.valueScore),      ...uHotels],
                restaurants: [...data.restaurants.map(addScore).sort((a,b) => b.valueScore - a.valueScore), ...uRestaurants],
                cafes:       [...data.cafes.map(addScore).sort((a,b) => b.valueScore - a.valueScore),       ...uCafes],
                activities:  [...data.activities.map(addScore).sort((a,b) => b.valueScore - a.valueScore),  ...uActivities],
            }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

const _fetchExplorerCategory = async (lat, lng, radius, types, categoryLabel, cityName) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    try {
        const response = await axios.post('https://places.googleapis.com/v1/places:searchNearby',
            { includedTypes: types, maxResultCount: 20, locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } } },
            { headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos,places.priceLevel,places.currentOpeningHours,places.editorialSummary,places.regularOpeningHours,places.internationalPhoneNumber,places.websiteUri,places.types' }, timeout: 12000 }
        );
        const places = response.data.places || [];
        return places.map(p => normalizeGooglePlace(p, categoryLabel, cityName));
    } catch (err) { return []; }
};

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
