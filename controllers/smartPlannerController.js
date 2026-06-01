const SmartPlan = require('../models/SmartPlan');
const { cityExplorer } = require('./citySearchController');

/**
 * Pure Algorithm-based Value Score Ranking
 */
function calcValueScore(place, userPreferences = [], userBudgetPerDay = 0) {
  const rating = place.rating || 4.0;
  const price = place.price || place.estimatedCost || 100;
  const maxPrice = 5000;

  // Base score: 60% rating + 40% price efficiency
  const ratingScore = (rating / 5.0) * 60;
  const priceScore = (1 - Math.min(price / maxPrice, 1)) * 40;
  let score = ratingScore + priceScore;

  // Bonus: +15 if matches user preferences
  if (userPreferences.length > 0) {
    const placeText = `${place.name} ${place.category || ''} ${place.type || ''} ${place.address || ''}`.toLowerCase();
    const prefMatch = userPreferences.some(pref =>
      placeText.includes(pref.toLowerCase())
    );
    if (prefMatch) score += 15;
  }

  // Bonus: +10 if within budget
  if (userBudgetPerDay > 0 && price <= userBudgetPerDay) score += 10;

  // Bonus: +5 if highly rated (4.5+)
  if (rating >= 4.5) score += 5;

  return Math.round(score * 10) / 10;
}

/**
 * Smart Day Planner Controller (Algorithm Edition)
 */

// POST /api/trips/smart-plan
exports.generateSmartPlan = async (req, res) => {
  const { userId, city, days, walletBalance, preferences = [] } = req.body;

  console.log(`[Algorithm Planner] 🚀 Generating ${days}-day plan for ${city} (Budget: ${walletBalance})`);

  try {
    // 1. Fetch real places using cityExplorer logic
    let explorerData = null;
    const mockRes = {
      status: () => ({
        json: (data) => {
          explorerData = data;
        }
      })
    };
    
    await cityExplorer({ query: { city } }, mockRes);

    if (!explorerData || !explorerData.success) {
      throw new Error("Failed to fetch places for the city.");
    }

    const { grouped } = explorerData;
    const budgetPerDay = walletBalance / days;

    // 2. Score and prepare pools
    const score = (p) => calcValueScore(p, preferences, budgetPerDay);
    
    console.log(`[Algorithm] Scoring places for ${city}...`);
    
    let hotelsPool      = (grouped.hotels || []).sort((a,b) => score(b) - score(a));
    let restaurantsPool = (grouped.restaurants || []).sort((a,b) => score(b) - score(a));
    let cafesPool       = (grouped.cafes || []).sort((a,b) => score(b) - score(a));
    let activitiesPool  = (grouped.activities || []).sort((a,b) => score(b) - score(a));

    // 3. Greedy Day Allocation
    let generatedDays = [];
    let totalEstimatedCost = 0;

    for (let i = 1; i <= days; i++) {
      let daySlots = [];
      let currentDayCost = 0;

      // Slot 1: Breakfast (Cafe)
      const breakfast = cafesPool.find(p => p.price <= budgetPerDay * 0.20) || cafesPool[0] || _getFallbackItem('breakfast', city);
      daySlots.push({
        time: "09:00",
        type: "breakfast",
        placeName: breakfast.name,
        estimatedCost: breakfast.price || 100,
        duration: "1h",
        notes: "Start your morning with local vibes.",
        imageUrl: breakfast.imageUrl,
        lat: breakfast.lat,
        lng: breakfast.lng,
        rating: breakfast.rating,
        id: breakfast.id
      });
      currentDayCost += (breakfast.price || 100);
      cafesPool = cafesPool.filter(p => p.id !== breakfast.id);

      // Slot 2: Morning Activity
      const morningAct = activitiesPool.find(p => p.price <= budgetPerDay * 0.40) || activitiesPool[0] || _getFallbackItem('activity', city);
      daySlots.push({
        time: "11:00",
        type: "activity",
        placeName: morningAct.name,
        estimatedCost: morningAct.price || 200,
        duration: "3h",
        notes: "Explore a major landmark.",
        imageUrl: morningAct.imageUrl,
        lat: morningAct.lat,
        lng: morningAct.lng,
        rating: morningAct.rating,
        id: morningAct.id
      });
      currentDayCost += (morningAct.price || 200);
      activitiesPool = activitiesPool.filter(p => p.id !== morningAct.id);

      // Slot 3: Lunch
      const lunch = restaurantsPool.find(p => p.price <= budgetPerDay * 0.25) || restaurantsPool[0] || _getFallbackItem('lunch', city);
      daySlots.push({
        time: "14:30",
        type: "lunch",
        placeName: lunch.name,
        estimatedCost: lunch.price || 150,
        duration: "1.5h",
        notes: "Authentic local flavors for lunch.",
        imageUrl: lunch.imageUrl,
        lat: lunch.lat,
        lng: lunch.lng,
        rating: lunch.rating,
        id: lunch.id
      });
      currentDayCost += (lunch.price || 150);
      restaurantsPool = restaurantsPool.filter(p => p.id !== lunch.id);

      // Slot 4: Evening Activity
      const eveningAct = activitiesPool.find(p => p.price <= budgetPerDay * 0.35) || activitiesPool[0] || _getFallbackItem('activity', city);
      daySlots.push({
        time: "17:00",
        type: "activity",
        placeName: eveningAct.name,
        estimatedCost: eveningAct.price || 150,
        duration: "2h",
        notes: "A perfect way to end the day.",
        imageUrl: eveningAct.imageUrl,
        lat: eveningAct.lat,
        lng: eveningAct.lng,
        rating: eveningAct.rating,
        id: eveningAct.id
      });
      currentDayCost += (eveningAct.price || 150);
      activitiesPool = activitiesPool.filter(p => p.id !== eveningAct.id);

      generatedDays.push({
        dayNumber: i,
        dayTitle: `Day ${i}: Exploring ${city}`,
        totalDayCost: currentDayCost,
        slots: daySlots
      });
      totalEstimatedCost += currentDayCost;
    }

    // 4. Build Final Plan
    const plan = {
      planTitle: `${days} Days in ${city} 🌟`,
      city,
      days: days,
      budgetPerDay: Math.round(budgetPerDay),
      totalEstimatedCost,
      budgetWarning: totalEstimatedCost > walletBalance
        ? `⚠️ Plan exceeds budget by ${totalEstimatedCost - walletBalance} EGP`
        : null,
      aiTip: _getAlgorithmTip(city, preferences, walletBalance),
      days: generatedDays,
      algorithm: 'greedy_value_score_v2'
    };

    // 5. Save to MongoDB
    const savedPlan = new SmartPlan({
      userId,
      city,
      days,
      walletBalance,
      totalEstimatedCost: plan.totalEstimatedCost,
      planTitle: plan.planTitle,
      planData: plan
    });
    await savedPlan.save();

    console.log(`[Algorithm Planner] ✅ Plan generated and saved.`);
    return res.status(200).json({ success: true, plan: { ...plan, id: savedPlan._id } });

  } catch (error) {
    console.error("[Algorithm Planner] Controller Error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/trips/smart-plans/:userId
exports.getUserPlans = async (req, res) => {
  try {
    const plans = await SmartPlan.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/trips/smart-plans/:planId
exports.deletePlan = async (req, res) => {
  try {
    await SmartPlan.findByIdAndDelete(req.params.planId);
    return res.status(200).json({ success: true, message: "Plan deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Smart tip generator (no AI needed)
function _getAlgorithmTip(city, preferences, budget) {
  const tips = {
    'Hurghada': 'Book diving activities in advance for better prices! 🤿',
    'Luxor': 'Visit temples early morning to avoid crowds! 🏛️',
    'Cairo': 'Friday mornings are best for Pyramids visit! 🏺',
    'Aswan': 'Felucca rides at sunset are magical! 🛶',
    'Sharm El-Sheikh': 'Ras Mohammed Park is a must-see! 🐠',
    'Alexandria': 'Enjoy a sunset walk at the Corniche! 🌊',
    'Dahab': 'Blue Hole snorkeling is a lifetime experience! 🏄',
    'default': 'Mix activities with relaxation for the perfect trip! ✈️',
  };
  return tips[city] || tips['default'];
}

function _getFallbackItem(type, city) {
  const fallbacks = {
    breakfast: { name: 'Local Breakfast Spot', price: 80, rating: 4.2 },
    lunch: { name: 'Authentic Lunch Restaurant', price: 150, rating: 4.4 },
    activity: { name: 'Popular Landmark', price: 100, rating: 4.5 }
  };
  return { ...fallbacks[type], id: `fallback_${type}`, imageUrl: '' };
}
