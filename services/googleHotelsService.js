const axios = require('axios');

/**
 * Fetches hotel data from Google Hotels via Serper.dev
 * @param {string} location - The location to search for
 * @returns {Array} List of hotels
 */
exports.fetchGoogleHotels = async (location) => {
    try {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            console.error("SERPER_API_KEY is missing");
            return [];
        }

        const data = JSON.stringify({
            "q": `hotels in ${location}`,
        });

        const config = {
            method: 'post',
            url: 'https://google.serper.dev/search',
            headers: { 
                'X-API-KEY': apiKey, 
                'Content-Type': 'application/json'
            },
            data : data
        };

        const response = await axios(config);
        
        // Serper returns organic results, we need to map them to a hotel-like structure if possible
        // Or if using the 'places' engine which is better for hotels:
        // Let's try the 'places' engine if the user meant that. 
        // For now, I'll stick to search results and parse them, or use the 'places' endpoint.
        // Let's use the 'places' endpoint of Serper.
        
        const placesConfig = {
            method: 'post',
            url: 'https://google.serper.dev/places',
            headers: { 
                'X-API-KEY': apiKey, 
                'Content-Type': 'application/json'
            },
            data : JSON.stringify({ "q": `hotels in ${location}` })
        };
        
        const placesResponse = await axios(placesConfig);
        return placesResponse.data.places || [];

    } catch (error) {
        console.error("Google Hotels API Error:", error.message);
        return [];
    }
};
