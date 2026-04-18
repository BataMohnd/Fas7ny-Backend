const axios = require('axios');

async function testTripadvisor() {
    const apiKey = '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237';
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
