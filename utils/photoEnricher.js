/**
 * photoEnricher.js
 * Fetches real Google Places photos for places/hotels that have missing or invalid images.
 * Never throws to the caller — all errors are caught and return null / fallback URLs.
 */

const axios = require('axios');

const GOOGLE_PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the URL is a real, usable image URL.
 */
function _isValidUrl(url) {
    if (!url) return false;
    if (typeof url !== 'string') return false;
    if (url.trim() === '') return false;
    if (url.startsWith('data:')) return false;        // base64 blobs
    if (url.includes('placeholder')) return false;    // placeholder.com etc.
    if (url.includes('no-image')) return false;
    if (url.includes('default.jpg')) return false;
    if (url.includes('via.placeholder')) return false;
    return url.startsWith('http');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 1. getGooglePlacePhoto(placeName, city, category)
 *    Calls Google Find Place → Place Details to get a real photo URL.
 *    Returns photo URL string, or null on any failure.
 */
async function getGooglePlacePhoto(placeName, city = '', category = 'hotel') {
    if (!GOOGLE_PLACES_KEY) return null;

    try {
        const input = [placeName, city, category].filter(Boolean).join(' ');

        // Step 1: Find Place → get place_id + photos
        const findRes = await axios.get(
            'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
            {
                params: {
                    input,
                    inputtype: 'textquery',
                    fields: 'place_id,photos,name',
                    key: GOOGLE_PLACES_KEY,
                },
                timeout: 6000,
            }
        );

        const candidates = findRes.data?.candidates || [];
        if (candidates.length === 0) return null;

        const candidate = candidates[0];

        // If Find Place already returned photos, use them directly
        if (candidate.photos && candidate.photos.length > 0) {
            const ref = candidate.photos[0].photo_reference;
            return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_PLACES_KEY}`;
        }

        // Step 2: Place Details → fetch photos via place_id
        if (!candidate.place_id) return null;

        const detailsRes = await axios.get(
            'https://maps.googleapis.com/maps/api/place/details/json',
            {
                params: {
                    place_id: candidate.place_id,
                    fields: 'photos',
                    key: GOOGLE_PLACES_KEY,
                },
                timeout: 6000,
            }
        );

        const photos = detailsRes.data?.result?.photos || [];
        if (photos.length === 0) return null;

        const ref = photos[0].photo_reference;
        return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_PLACES_KEY}`;

    } catch (err) {
        console.warn(`[photoEnricher] getGooglePlacePhoto failed for "${placeName}": ${err.message}`);
        return null;
    }
}

/**
 * 2. enrichPlacesWithPhotos(places, city)
 *    Iterates over an array of place/hotel objects.
 *    If the image URL is missing/invalid, fetches a real Google photo.
 *    Uses Promise.allSettled so one failure never breaks the rest.
 *    Always returns an array of the same length as input.
 */
async function enrichPlacesWithPhotos(places, city = '') {
    if (!Array.isArray(places) || places.length === 0) return places;

    // Only skip enrichment if we'd be doing 100% fallbacks (no API key)
    const useGoogle = Boolean(GOOGLE_PLACES_KEY);

    const results = await Promise.allSettled(
        places.map(async (place) => {
            try {
                // Detect the primary image field (hotels vs places differ)
                const currentUrl = place.mainPhotoUrl || place.imageUrl || place.image || '';
                if (_isValidUrl(currentUrl)) {
                    return { ...place, photoSource: 'original' };
                }

                const name     = place.hotelName || place.name || '';
                const category = place.category || 'hotel';

                // Try Google Places first
                let newUrl = null;
                if (useGoogle && name) {
                    newUrl = await getGooglePlacePhoto(name, city, category);
                }

                // Fall back to Unsplash if Google failed or key is missing
                if (!newUrl) {
                    newUrl = getFallbackImage(category);
                }

                // Patch whichever image field the object uses
                const enriched = { ...place };
                if ('mainPhotoUrl' in place || place.hotelId) enriched.mainPhotoUrl = newUrl;
                if ('imageUrl'     in place)                  enriched.imageUrl     = newUrl;
                if ('image'        in place)                  enriched.image        = newUrl;
                enriched.photoSource = newUrl.includes('unsplash') ? 'fallback' : 'google_places';

                return enriched;
            } catch (err) {
                console.warn(`[photoEnricher] Enrich error for "${place.name || place.hotelName}": ${err.message}`);
                return place; // Return unchanged on unexpected error
            }
        })
    );

    // Promise.allSettled always resolves — extract value or fallback to original
    return results.map((result, i) =>
        result.status === 'fulfilled' ? result.value : places[i]
    );
}

/**
 * 3. getFallbackImage(category)
 *    Returns a themed Unsplash URL based on place category.
 */
function getFallbackImage(category = 'hotel') {
    const cat = (category || 'hotel').toLowerCase();

    const map = {
        hotel:       'https://source.unsplash.com/800x600/?hotel,egypt,luxury',
        hotels:      'https://source.unsplash.com/800x600/?hotel,egypt,luxury',
        lodging:     'https://source.unsplash.com/800x600/?hotel,egypt,luxury',
        resort:      'https://source.unsplash.com/800x600/?resort,pool,luxury',
        restaurant:  'https://source.unsplash.com/800x600/?restaurant,food,egypt',
        dining:      'https://source.unsplash.com/800x600/?restaurant,food,egypt',
        cafe:        'https://source.unsplash.com/800x600/?cafe,coffee,cozy',
        coffee:      'https://source.unsplash.com/800x600/?cafe,coffee,cozy',
        activity:    'https://source.unsplash.com/800x600/?egypt,adventure,tourism',
        activities:  'https://source.unsplash.com/800x600/?egypt,adventure,tourism',
        attraction:  'https://source.unsplash.com/800x600/?egypt,ancient,landmark',
        museum:      'https://source.unsplash.com/800x600/?museum,art,culture',
        beach:       'https://source.unsplash.com/800x600/?beach,egypt,red-sea',
        diving:      'https://source.unsplash.com/800x600/?diving,coral,red-sea',
        spa:         'https://source.unsplash.com/800x600/?spa,wellness,relax',
    };

    return map[cat] || 'https://source.unsplash.com/800x600/?egypt,landmark,ancient';
}

module.exports = { getGooglePlacePhoto, enrichPlacesWithPhotos, getFallbackImage };
