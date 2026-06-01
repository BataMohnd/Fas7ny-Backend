const axios = require('axios');
const { callGemini } = require('../utils/geminiClient');
const Place = require('../models/Place');

const RAPID_API_KEY = process.env.RAPIDAPI_KEY;
const RAPID_API_HOST = 'tripadvisor16.p.rapidapi.com';
const BASE_URL = `https://${RAPID_API_HOST}/api/v1`;

// Extract required fields specifically for flutter display
const extractPlaceData = (place) => ({
    name: place?.name || place?.title || "Unknown Place",
    rating: place?.rating || place?.bubbleRating || place?.bubbleRatingText || "N/A",
    description: place?.description || place?.primaryInfo || "No description available",
    photo: place?.photo?.images?.large?.url || place?.thumbnail || place?.image || "https://via.placeholder.com/150"
});

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

        // 3. AI Integration via Google Gemini 2.5 Flash
        let aiItinerary = "Marhaba! I'm Fas7ny AI. We couldn't build your custom plan right now, but definitely check out the top spots listed below! 🇪🇬✨";

        try {
            const systemInstruction = "You are 'Fas7ny AI', an expert Egyptian travel guide. Your goal is to build fun, compact 3-day plans for Egypt using data provided in JSON format.";
            const prompt = `${systemInstruction}\n\nContext Data: ${JSON.stringify(promptData)}`;

            const aiResult = await callGemini(prompt);
            if (aiResult.ok) {
                aiItinerary = aiResult.text;
                // Success log moved to client
            } else {
                console.log(`📡 [Trips] Using static fallback due to: ${aiResult.error}`);
            }
        } catch (geminiErr) {
            console.error("❌ Trip Itinerary Logic Error:", geminiErr.message);
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

// ─── NEW: Smart Trip Planner using Greedy Algorithm ───
exports.generateTripPlan = async (req, res) => {
    try {
        const { destination, days, totalBudget } = req.body;

        if (!destination || !days || !totalBudget) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const dailyBudget = totalBudget / days;

        // Query MongoDB for places in the destination
        const hotels = await Place.find({ city: new RegExp(destination, 'i'), category: 'hotel' }).sort({ price: 1 }).lean();
        const activities = await Place.find({ city: new RegExp(destination, 'i'), category: { $ne: 'hotel' } }).sort({ price: 1 }).lean();

        if (hotels.length === 0 || activities.length === 0) {
            return res.status(404).json({ success: false, message: "Not enough places found in this destination to plan a trip." });
        }

        const itinerary = [];
        let remainingBudget = totalBudget;

        for (let i = 1; i <= days; i++) {
            // Greedy approach: Pick the best fitting affordable hotel and 2 activities for the day
            let dailySpent = 0;
            let selectedHotel = null;
            let selectedActivities = [];

            // Find a hotel that fits within ~50% of the daily budget, or the cheapest available
            selectedHotel = hotels.find(h => h.price <= (dailyBudget * 0.5)) || hotels[0];
            dailySpent += selectedHotel.price;

            // Pick 2 distinct activities
            for (let j = 0; j < activities.length; j++) {
                if (selectedActivities.length < 2 && (dailySpent + activities[j].price) <= dailyBudget) {
                    selectedActivities.push(activities[j]);
                    dailySpent += activities[j].price;
                }
            }

            // Fallback: If we couldn't find 2 activities within budget, just take the cheapest ones
            if (selectedActivities.length < 2) {
                 const fallbackActivities = activities.slice(0, 2);
                 fallbackActivities.forEach(a => {
                     if(!selectedActivities.find(sa => sa._id === a._id)){
                         selectedActivities.push(a);
                         dailySpent += a.price;
                     }
                 });
            }

            remainingBudget -= dailySpent;

            itinerary.push({
                day: i,
                hotel: selectedHotel,
                activities: selectedActivities,
                dailyCost: dailySpent
            });
        }

        if (remainingBudget < 0) {
            return res.status(200).json({
                success: true,
                warning: "Your budget is very tight or insufficient for this destination. Here is the cheapest possible itinerary.",
                data: {
                    destination,
                    days,
                    totalCost: totalBudget - remainingBudget,
                    itinerary
                }
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                destination,
                days,
                totalCost: totalBudget - remainingBudget,
                itinerary
            }
        });

    } catch (error) {
        console.error("❌ /api/trips/generate Error:", error);
        return res.status(500).json({ success: false, message: "Server Error during trip generation" });
    }
};
