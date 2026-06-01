const axios = require('axios');
require('dotenv').config();

async function testTripadvisor() {
    const apiKey = process.env.RAPIDAPI_KEY;
    const host = 'tripadvisor16.p.rapidapi.com';

    try {
        console.log("Searching location...");
        const locRes = await axios.get('https://tripadvisor16.p.rapidapi.com/api/v1/hotels/searchLocation', {
            params: { query: 'Cairo' },
            headers: {
                'x-rapidapi-key': apiKey,
                'x-rapidapi-host': host
            }
        });
        
        console.log("Location Response:", JSON.stringify(locRes.data, null, 2));
    } catch (err) {
        console.error("Error:", err.response ? err.response.data : err.message);
    }
}

testTripadvisor();
