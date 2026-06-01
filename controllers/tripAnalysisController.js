const Booking  = require('../models/Booking');
const Rating   = require('../models/Rating');
const User     = require('../models/User');

/**
 * GET /api/trips/analysis/:userId
 *
 * Returns aggregated comparison between manual and AI-generated trips:
 */
exports.getTripAnalysis = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(401).json({ success: false, message: 'Missing userId' });

        // ── 1. Fetch all bookings for this user ───────────────────────────────
        const allBookings = await Booking.find({ userId }).lean();

        if (allBookings.length === 0) {
            return res.status(200).json({
                success: true,
                totalTrips: 0,
                manualCount: 0, aiCount: 0,
                manualAvgCost: 0, aiAvgCost: 0,
                interestCoverage: 0,
                avgRating: 0,
                costTrend: [],
                message: 'No bookings found yet. Start exploring!'
            });
        }

        // Robust source filtering
        const aiBookings = allBookings.filter(b => 
            b.source === 'ai' || b.source === 'AI' || b.source === 'smart_plan'
        );
        const manualBookings = allBookings.filter(b => 
            !aiBookings.some(ai => ai._id?.toString() === b._id?.toString())
        );

        console.log(`[Trip Analysis] User: ${userId} | Total: ${allBookings.length} | Manual: ${manualBookings.length} | AI: ${aiBookings.length}`);
        console.log(`[Trip Analysis] Sources found:`, [...new Set(allBookings.map(b => b.source || 'undefined'))]);

        // ── 2. Cost averages (Fixed calculation with realistic filter) ────────
        // Filter realistic booking prices (real bookings are between 50 and 50,000 EGP)
        const realisticManual = manualBookings.filter(b => b.totalPrice > 0 && b.totalPrice < 50000);
        const realisticAI     = aiBookings.filter(b => b.totalPrice > 0 && b.totalPrice < 50000);

        const manualAvgCost = realisticManual.length > 0
            ? realisticManual.reduce((sum, b) => sum + (b.totalPrice || 0), 0) / realisticManual.length
            : 0;

        const aiAvgCost = realisticAI.length > 0
            ? realisticAI.reduce((sum, b) => sum + (b.totalPrice || 0), 0) / realisticAI.length
            : 0;

        console.log(`[Trip Analysis] Manual avg: ${Math.round(manualAvgCost)} EGP | AI avg: ${Math.round(aiAvgCost)} EGP`);

        // ── 3. Interest coverage metric (Enhanced) ────────────────────────────
        let interestCoverage = 0;
        const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] }).select('interests');
        const userInterests = (user?.interests || []).map(i => i.toLowerCase());

        if (userInterests.length > 0) {
            const coveredInterests = userInterests.filter(interest =>
                allBookings.some(b =>
                    (b.placeName || '').toLowerCase().includes(interest.toLowerCase()) ||
                    (b.placeType || '').toLowerCase().includes(interest.toLowerCase()) ||
                    (b.interestTags || []).some(tag => tag.toLowerCase().includes(interest.toLowerCase()))
                )
            );
            interestCoverage = parseFloat((coveredInterests.length / userInterests.length).toFixed(2));
        } else {
            // No interests set → diversity score (max 4 unique place types = 100%)
            const placeTypes = [...new Set(allBookings.map(b => b.placeType).filter(Boolean))];
            const uniqueTypeCount = Math.min(placeTypes.length, 4); // cap at 4
            interestCoverage = uniqueTypeCount / 4.0; // returns 0.0 to 1.0
            console.log(`[Trip Analysis] Diversity types: ${placeTypes.join(', ')} → ${Math.round(interestCoverage * 100)}%`);
        }

        // ── 4. Average rating (Estimated if missing) ─────────────────────────
        const avgRatingValue = allBookings.length > 0
            ? allBookings.reduce((sum, b) => {
                const rating = b.rating ||
                    (b.totalPrice > 2000 ? 4.5 :
                     b.totalPrice > 1000 ? 4.2 :
                     b.totalPrice > 500  ? 4.0 : 3.8);
                return sum + rating;
            }, 0) / allBookings.length
            : 0;
        
        const avgRating = parseFloat(avgRatingValue.toFixed(1));

        // ── 5. Monthly cost trend (last 6 months) ─────────────────────────────
        const now = new Date();
        const costTrend = Array.from({ length: 6 }, (_, i) => {
            const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
            const nextMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
            const monthBookings = allBookings.filter(b => {
                const d = new Date(b.createdAt || b.checkIn);
                return d >= monthDate && d < nextMonth;
            });
            const totalSpend = monthBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
            return {
                month: monthDate.toLocaleString('en-US', { month: 'short' }),
                totalSpend,
                count: monthBookings.length,
            };
        });

        // ── 6. Activities count ───────────────────────────────────────────────
        const activityBookings = allBookings.filter(b => ['activity', 'attraction', 'restaurant', 'cafe'].includes(b.placeType));
        const hotelBookings    = allBookings.filter(b => b.placeType === 'hotel');

        return res.status(200).json({
            success: true,
            totalTrips: allBookings.length,
            manualCount: manualBookings.length,
            aiCount: aiBookings.length,
            manualAvgCost: Math.round(manualAvgCost),
            aiAvgCost: Math.round(aiAvgCost),
            interestCoverage: parseFloat((interestCoverage * 100).toFixed(0)), // Return as percentage for UI
            avgRating,
            activityCount: activityBookings.length,
            hotelCount: hotelBookings.length,
            costTrend,
        });

    } catch (error) {
        console.error('[Trip Analysis] Error:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

function calcValueScore(place, maxRating, maxPrice) {
    const ratingScore = maxRating > 0 ? (place.rating / maxRating) * 60 : 0;
    const priceScore  = maxPrice  > 0 ? (1 - place.price / maxPrice) * 40 : 40;
    return Math.round((ratingScore + priceScore) * 10) / 10;
}

/**
 * GET /api/trips/comparison/:userId
 *
 * Analyzes bookings and compares places by calculating a Value Score.
 */
exports.getPlaceComparison = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(401).json({ success: false, message: 'Missing userId' });

        const allBookings = await Booking.find({ userId }).lean();
        
        if (allBookings.length === 0) {
            return res.status(200).json({ success: true, groups: {} });
        }

        const groups = {};

        // 1. Group bookings by placeType
        const grouped = allBookings.reduce((acc, booking) => {
            const type = booking.placeType || 'activity';
            if (!acc[type]) acc[type] = [];
            
            // Deduplicate places by ID
            const exists = acc[type].find(p => p.id === booking.placeId);
            if (!exists) {
                acc[type].push({
                    id: booking.placeId,
                    name: booking.placeName || 'Unknown',
                    price: booking.totalPrice || 0,
                    rating: booking.rating || 
                           (booking.totalPrice > 2000 ? 4.5 :
                            booking.totalPrice > 1000 ? 4.2 :
                            booking.totalPrice > 500  ? 4.0 : 3.8),
                    bookingDate: booking.createdAt || booking.checkIn
                });
            }
            return acc;
        }, {});

        // 2. Calculate value score for each group
        for (const [type, places] of Object.entries(grouped)) {
            if (places.length === 0) continue;

            const maxRating = Math.max(...places.map(p => p.rating), 0.1);
            const maxPrice = Math.max(...places.map(p => p.price), 0.1);

            let bestValue = null;
            let bestRating = null;
            let cheapest = null;
            let totalPrice = 0;
            let totalRating = 0;

            const scoredPlaces = places.map(place => {
                const valueScore = calcValueScore(place, maxRating, maxPrice);
                
                if (!bestValue || valueScore > bestValue.valueScore) {
                    bestValue = { name: place.name, valueScore };
                }
                if (!bestRating || place.rating > bestRating.rating) {
                    bestRating = { name: place.name, rating: place.rating };
                }
                if (!cheapest || place.price < cheapest.price) {
                    cheapest = { name: place.name, price: place.price };
                }

                totalPrice += place.price;
                totalRating += place.rating;

                return { ...place, valueScore };
            });

            // Sort by value score descending
            scoredPlaces.sort((a, b) => b.valueScore - a.valueScore);

            groups[type] = {
                places: scoredPlaces,
                bestValue,
                bestRating,
                cheapest,
                avgPrice: Math.round(totalPrice / places.length),
                avgRating: Math.round((totalRating / places.length) * 10) / 10
            };
        }

        return res.status(200).json({ success: true, groups });

    } catch (error) {
        console.error('[Place Comparison] Error:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
