const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const RAPID_API_KEY = process.env.RAPIDAPI_KEY || '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237';
const RAPID_API_HOST = 'tripadvisor16.p.rapidapi.com';
const BASE_URL = `https://${RAPID_API_HOST}/api/v1`;

// Extract required fields specifically for flutter display
const extractPlaceData = (place) => ({
    name: place?.name || place?.title || "Unknown Place",
    rating: place?.rating || place?.bubbleRating || place?.bubbleRatingText || "N/A",
    description: place?.description || place?.primaryInfo || "No description available",
    photo: place?.photo?.images?.large?.url || place?.thumbnail || place?.image || "https://via.placeholder.com/150"
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.searchTrips = async (req, res) => {
    console.log(`📡 [Fas7ny AI] Handling Trip Search Request at 192.168.1.69:5000`);
    const apiKey = process.env.GEMINI_API_KEY;
    console.log("📡 [Fas7ny AI] Current API Key:", apiKey ? apiKey.substring(0, 5) + "..." : "MISSING");

    try {
        const query = req.query.query || 'Cairo';
        const origin = req.query.origin || 'Cairo';
        const destination = req.query.destination || query;
        const departureDate = req.query.date || 'Today';

        const headers = {
            'x-rapidapi-key': RAPID_API_KEY,
            'x-rapidapi-host': RAPID_API_HOST
        };

        // 1. Get Location ID from Tripadvisor Location Search
        let locationId = "294201"; // Default exact ID for Cairo, Egypt
        try {
            const locRes = await axios.get(`${BASE_URL}/hotels/searchLocation`, {
                params: { query: destination },
                headers
            });
            const firstResult = locRes.data?.data?.[0];
            if (firstResult && firstResult.geoId) {
                locationId = firstResult.geoId;
            }
        } catch (locErr) {
            console.log(`⚠️ Failed to fetch exact location for ${query}. Using default/fallback ID.`, locErr.message);
        }

        // 2. Fetch Hotels, Attractions, Restaurants in Parallel
        const [hotelsRes, attractionsRes, restaurantsRes] = await Promise.allSettled([
            axios.get(`${BASE_URL}/hotels/searchHotels`, {
                params: { geoId: locationId },
                headers
            }),
            axios.get(`${BASE_URL}/attractions/searchAttractions`, {
                params: { geoId: locationId },
                headers
            }),
            axios.get(`${BASE_URL}/restaurant/searchRestaurants`, {
                params: { geoId: locationId },
                headers
            })
        ]);

        // Map and extract data safely
        const hotels = hotelsRes.status === 'fulfilled'
            ? (hotelsRes.value.data?.data?.data || []).map(extractPlaceData)
            : [];

        const attractions = attractionsRes.status === 'fulfilled'
            ? (attractionsRes.value.data?.data?.data || []).map(extractPlaceData)
            : [];

        const restaurants = restaurantsRes.status === 'fulfilled'
            ? (restaurantsRes.value.data?.data?.data || []).map(extractPlaceData)
            : [];

        // Truncate to top 5 for the prompt to avoid excessive tokens
        const promptData = {
            query: destination,
            hotels: hotels.slice(0, 5),
            attractions: attractions.slice(0, 5),
            restaurants: restaurants.slice(0, 5)
        };

        // 3. AI Integration via Google Gemini 1.5 Flash
        let aiItinerary = "Marhaba! I'm Fas7ny AI. We couldn't build your custom plan right now, but definitely check out the top spots listed below! 🇪🇬✨";

        try {
            const systemInstruction = "You are 'Fas7ny AI', an expert Egyptian travel guide. Your goal is to build fun, compact 3-day plans for Egypt using data provided in JSON format.";
            
            // --- Bulletproof AI Configuration: Direct API Call (Bypassing SDK) ---
            const apiKey = process.env.GEMINI_API_KEY;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

            console.log("📤 Sending DIRECT call to Gemini Flash Latest (v1beta)...");
            const response = await axios.post(url, {
                contents: [
                    {
                        role: "user",
                        parts: [{ text: `Context: ${systemInstruction}` }]
                    },
                    {
                        role: "model",
                        parts: [{ text: "Understood! I am Fas7ny, your local travel guide. 🇪🇬✨" }]
                    },
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ]
            });

            aiItinerary = response.data.candidates[0].content.parts[0].text;
            console.log("✅ Direct Gemini Response Success for Trips");
        } catch (geminiErr) {
            console.error("❌ DIRECT GEMINI API ERROR (Trips):", geminiErr.response ? geminiErr.err.response.data : geminiErr.message);
            // Fallback already set above
        }

        // 4. Generate Enhanced Mock Flights based on Origin -> Destination
        const mockFlights = [
            { airline: "EgyptAir", price: 4500, time: "10:30 AM", type: "Direct" },
            { airline: "Nile Air", price: 3200, time: "02:15 PM", type: "Direct" },
            { airline: "Air Cairo", price: 2800, time: "08:45 PM", type: "1 Stop" }
        ].map(f => ({
            name: `${f.airline} to ${destination}`,
            rating: `${f.price} EGP`, // Storing price in rating for easy display
            description: `Flight from ${origin} to ${destination} on ${departureDate}. ${f.type} departing at ${f.time}.`,
            photo: "https://images.unsplash.com/photo-1436491865332-7a61a109c0f3?q=80&w=1000&auto=format&fit=crop"
        }));

        // 5. Return Structured Data expected by Flutter
        return res.status(200).json({
            success: true,
            data: {
                location: destination,
                hotels,
                attractions,
                restaurants,
                flights: mockFlights,
                aiItinerary
            }
        });

    } catch (error) {
        console.error("❌ /api/v2/trips/search Error:", error);
        return res.status(500).json({ success: false, message: "Server Error during trip search" });
    }
};
