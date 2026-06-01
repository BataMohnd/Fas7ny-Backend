const axios = require('axios');

/**
 * 🗺️ Google Places API Service (New v1 Implementation)
 * Fetches nearby attractions and restaurants using spatial queries.
 */

async function searchNearbyPlaces({ lat, lng, radius, type }) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    // Explicit key detection and masked logging
    if (!apiKey || apiKey.length < 10) {
        console.error(`❌ [Google Places] CRITICAL: API Key is ${!apiKey ? 'MISSING' : 'MALFORMED (too short)'}.`);
        throw new Error("API_KEY_INVALID");
    }
    console.log(`📡 [Google Places] Diagnostics: Key starts with: ${apiKey.substring(0, 6)}...`);

    const url = 'https://places.googleapis.com/v1/places:searchNearby';
    
    // Type mapping for Google Places API categories (New 'dining' logic)
    let includedTypes = [];
    if (type === 'restaurant') {
        includedTypes = ["restaurant"];
    } else if (type === 'cafe') {
        includedTypes = ["cafe", "coffee_shop", "bakery"];
    } else if (type === 'dining') {
        includedTypes = ["restaurant", "cafe", "bakery"];
    } else if (type === 'entertainment') {
        includedTypes = ["tourist_attraction", "museum", "amusement_park", "park", "art_gallery", "movie_theater"];
    } else {
        // 'all' or default
        includedTypes = ["restaurant", "tourist_attraction", "museum", "cafe"];
    }

    const requestBody = {
        includedTypes: includedTypes,
        maxResultCount: 20,
        locationRestriction: {
            circle: {
                center: { latitude: lat, longitude: lng },
                radius: radius
            }
        }
    };

    try {
        console.log(`📡 [Google Places] Calling for Type: ${type} | IncludedTypes: ${includedTypes}`);
        
        const response = await axios.post(url, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.editorialSummary,places.nationalPhoneNumber,places.googleMapsUri'
            }
        });

        const places = response.data.places || [];
        console.log(`✅ [Google Places] Successfully fetched ${places.length} live results for ${type}.`);
        
        return places.map(p => ({
            id: p.id,
            name: p.displayName?.text || "Exciting Spot",
            address: p.formattedAddress || "Nearby Location",
            rating: p.rating || 4.5,
            reviewCount: p.userRatingCount || 0,
            location: {
                latitude: p.location?.latitude,
                longitude: p.location?.longitude
            },
            types: p.types || [],
            phoneNumber: p.nationalPhoneNumber || null,
            mapUri: p.googleMapsUri || null,
            category: _inferCategory(p.types, type),
            imageUrl: _getPlaceholderImage(_inferCategory(p.types, type))
        }));

    } catch (error) {
        const status = error.response?.status;
        console.error(`❌ [Google Places] API Error: [Status ${status}] | ${error.message}`);
        throw error;
    }
}

/**
 * Helper to infer Fas7ny category from Google types
 */
function _inferCategory(types = [], requestedType = 'unknown') {
    if (requestedType === 'cafe' || types.includes('cafe')) return 'cafe';
    if (types.includes('restaurant') || types.includes('food')) return 'restaurant';
    if (types.includes('museum') || types.includes('art_gallery')) return 'museum';
    if (types.includes('park') || types.includes('amusement_park')) return 'activity';
    return 'attraction';
}

/**
 * Reliable placeholder images for demo use
 */
function _getPlaceholderImage(category) {
    const images = {
        restaurant: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
        cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24",
        museum: "https://images.unsplash.com/photo-1518998053574-53ee81eb6449",
        activity: "https://images.unsplash.com/photo-1544005313-94ddf0286df2",
        attraction: "https://images.unsplash.com/photo-1503177119275-0aa32b3a9368"
    };
    return images[category] || images.attraction;
}

module.exports = { searchNearbyPlaces };
