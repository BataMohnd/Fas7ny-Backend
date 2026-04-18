const axios = require('axios');

/**
 * Fetches real-world attractions and cafes from Google Places via Serper.dev
 * @param {string} city - The city in Egypt to search in
 * @returns {Array} List of attractions
 */
exports.getAttractions = async (city) => {
    try {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            console.error("⚠️ [Fas7ny Backend] SERPER_API_KEY is missing in .env");
            return [];
        }

        const query = `tourist attractions and cafes in ${city}, Egypt`;
        console.log(`📡 [Attraction Service] Fetching: "${query}"`);

        const config = {
            method: 'post',
            url: 'https://google.serper.dev/places',
            headers: { 
                'X-API-KEY': apiKey, 
                'Content-Type': 'application/json'
            },
            data : JSON.stringify({ "q": query })
        };

        const response = await axios(config);
        const places = response.data.places || [];

        // Map to standard Fas7ny format
        return places.map(item => ({
            id: `google-place-${item.cid || Math.random()}`,
            name: item.title,
            rating: item.rating || 0,
            reviewCount: item.reviews || 0,
            latitude: item.latitude || 30.0444, // Fallback to Cairo
            longitude: item.longitude || 31.2357,
            category: item.category || 'General',
            address: item.address || city,
            imageUrl: item.thumbnailUrl || '',
            price: 150, // Default estimated entry fee/cafe spend in EGP
            currency: 'EGP',
            source: 'google_places'
        }));

    } catch (error) {
        console.error("❌ Attraction Service Error:", error.message);
        return [];
    }
};
