const Booking  = require('../models/Booking');
const Rating   = require('../models/Rating');
const User     = require('../models/User');

/**
 * GET /api/trips/analysis/:userId
 *
 * Returns aggregated comparison between manual and AI-generated trips:
 * {
 *   success: true,
 *   totalTrips: 12,
 *   manualCount: 8,     aiCount: 4,
 *   manualAvgCost: 3200, aiAvgCost: 2800,
 *   interestCoverage: 0.65,   // 0..1 fraction of user interests covered
 *   avgRating: 4.2,
 *   costTrend: [...]           // monthly cost data for line chart
 * }
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

        const manualBookings = allBookings.filter(b => (b.source || 'manual') === 'manual');
        const aiBookings     = allBookings.filter(b => b.source === 'ai');

        // ── 2. Cost averages ──────────────────────────────────────────────────
        const avg = (arr, field) => arr.length > 0
            ? arr.reduce((s, b) => s + (b[field] || 0), 0) / arr.length
            : 0;

        const manualAvgCost = avg(manualBookings, 'totalPrice');
        const aiAvgCost     = avg(aiBookings,     'totalPrice');

        // ── 3. Interest coverage metric ───────────────────────────────────────
        // Fraction of user's interests that appear in any booking's interestTags
        let interestCoverage = 0;
        try {
            const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] }).select('interests');
            const interests = (user?.interests || []).map(i => i.toLowerCase());
            if (interests.length > 0) {
                const coveredTags = new Set(allBookings.flatMap(b => (b.interestTags || [])));
                const matched = interests.filter(i => [...coveredTags].some(tag => tag.includes(i) || i.includes(tag)));
                interestCoverage = parseFloat((matched.length / interests.length).toFixed(2));
            }
        } catch (_) { /* non-critical */ }

        // ── 4. Average rating from Rating collection ──────────────────────────
        let avgRating = 0;
        try {
            const ratings = await Rating.find({ userId }).lean();
            if (ratings.length > 0) {
                avgRating = parseFloat((ratings.reduce((s, r) => s + (r.score || r.rating || 0), 0) / ratings.length).toFixed(1));
            }
        } catch (_) { /* Rating collection may be empty */ }

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

        console.log(`[Trip Analysis] User: ${userId} | Total: ${allBookings.length} | Manual: ${manualBookings.length} | AI: ${aiBookings.length} | Coverage: ${interestCoverage}`);

        return res.status(200).json({
            success: true,
            totalTrips: allBookings.length,
            manualCount: manualBookings.length,
            aiCount: aiBookings.length,
            manualAvgCost: Math.round(manualAvgCost),
            aiAvgCost: Math.round(aiAvgCost),
            interestCoverage,                          // 0.0 – 1.0
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
                    rating: booking.rating || (Math.random() * 2 + 3), // Fallback rating if none stored
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
