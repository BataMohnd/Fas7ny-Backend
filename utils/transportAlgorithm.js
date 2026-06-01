/**
 * transportAlgorithm.js
 * Smart Transport Scoring Algorithm for Fas7ny.
 *
 * Scores each transport option across 4 dimensions:
 *   budgetFit (40%)  — how well the price fits the user's budget
 *   speedScore (30%) — relative travel speed
 *   comfortScore (20%) — cabin class & operator quality
 *   travelBonus (10%) — match to trip type (adventure, family, business…)
 *
 * Final score: 0–100
 */

// ── Comfort tiers ─────────────────────────────────────────────────────────────

const COMFORT_SCORES = {
  // Trains
  sleeperdeluxe:    100,
  sleeperstandardd: 85,
  firstac:          90,
  secondac:         70,
  third:            40,
  // Buses
  vip:              82,
  ac:               65,
  standard:         45,
  // Flights
  first:            100,
  business:         92,
  economy:          75,
  // Cars
  luxury:           98,
  suv:              85,
  minivan:          78,
  standardcar:      70,
  economycar:       60,
};

// ── Operator prestige bonus ───────────────────────────────────────────────────

const OPERATOR_BONUS = {
  'egyptair':      10,
  'enr':           5,
  'gobus':         8,
  'superjet':      6,
  'air cairo':     7,
  'nile air':      6,
  'air arabia egypt': 5,
};

function _operatorBonus(operator = '') {
  return OPERATOR_BONUS[(operator || '').toLowerCase()] || 0;
}

// ── Score Helpers ─────────────────────────────────────────────────────────────

function _budgetFitScore(priceEGP, totalBudgetEGP) {
  if (!totalBudgetEGP || totalBudgetEGP <= 0) return 50; // neutral if unknown
  const ratio = priceEGP / totalBudgetEGP;
  if (ratio <= 0.10) return 100; // ≤10% of budget → excellent
  if (ratio <= 0.20) return 85;
  if (ratio <= 0.33) return 70;
  if (ratio <= 0.50) return 50;
  if (ratio <= 0.75) return 25;
  return 10; // too expensive
}

function _speedScore(durationMin, distanceKm) {
  if (!durationMin || durationMin <= 0) return 50;
  const speedKmh = distanceKm ? (distanceKm / durationMin) * 60 : 0;
  if (speedKmh >= 700) return 100; // flight
  if (speedKmh >= 150) return 90;  // fast train
  if (speedKmh >= 100) return 75;  // express train/bus
  if (speedKmh >= 70)  return 60;  // regular bus
  if (speedKmh >= 50)  return 45;  // slow bus/car in traffic
  return 30;
}

function _comfortScore(cabinClass = '', operator = '') {
  const key = (cabinClass || '').toLowerCase().replace(/[\s-]/g, '');
  const base = COMFORT_SCORES[key] || 60;
  return Math.min(100, base + _operatorBonus(operator));
}

function _travelTypeBonus(type, travelStyle = 'any') {
  const matrix = {
    flight:    { business: 10, family: 5, adventure: 5, luxury: 10, budget: -5, any: 0 },
    train:     { business: 5,  family: 8, adventure: 8, luxury: 3,  budget: 8,  any: 5 },
    bus:       { business: -5, family: 3, adventure: 6, luxury: -8, budget: 10, any: 3 },
    car:       { business: 8,  family: 10, adventure: 10, luxury: 8, budget: 2, any: 5 },
  };
  return (matrix[type] || {})[travelStyle.toLowerCase()] || 0;
}

// ── Main Scorer ───────────────────────────────────────────────────────────────

/**
 * Scores a single transport option.
 *
 * @param {object} option - Transport option
 * @param {object} ctx    - Context
 * @returns {object} option with .score and .breakdown added
 */
function scoreTransportOption(option, ctx = {}) {
  const {
    totalBudgetEGP = 0,
    distanceKm     = 0,
    travelStyle    = 'any',
  } = ctx;

  const price    = option.priceEGP || option.price || 0;
  const duration = option.durationMin || option.duration || 60;
  const cabin    = option.cabinClass  || option.class   || '';
  const operator = option.airline     || option.operator || option.name || '';
  const type     = option.type        || 'bus'; // flight | train | bus | car

  const budget  = _budgetFitScore(price, totalBudgetEGP)  * 0.40;
  const speed   = _speedScore(duration, distanceKm)       * 0.30;
  const comfort = _comfortScore(cabin, operator)           * 0.20;
  const bonus   = (_travelTypeBonus(type, travelStyle) + 50) * 0.10; // +50 so bonus sits in 40-60 range

  const score = Math.round(budget + speed + comfort + bonus);

  return {
    ...option,
    score: Math.min(100, Math.max(0, score)),
    scoreBreakdown: {
      budgetFit:   Math.round(budget),
      speed:       Math.round(speed),
      comfort:     Math.round(comfort),
      travelBonus: Math.round(bonus),
    },
  };
}

/**
 * Scores and ranks an array of transport options.
 * Injects type, normalizes fields, adds recommendation badge.
 *
 * @param {Array}  options     All transport options
 * @param {object} ctx         Context (totalBudgetEGP, distanceKm, travelStyle)
 * @returns {Array}            Sorted by score desc, top option tagged as recommended
 */
function rankTransportOptions(options, ctx = {}) {
  if (!options || options.length === 0) return [];

  const scored = options.map(opt => scoreTransportOption(opt, ctx));
  scored.sort((a, b) => b.score - a.score);

  // Mark top pick
  if (scored.length > 0) {
    scored[0].recommended = true;
    scored[0].badge = '⭐ Best Pick';
  }

  // Add value badge to cheapest option (if different from top)
  const cheapest = [...scored].sort((a, b) => (a.priceEGP || 0) - (b.priceEGP || 0))[0];
  if (cheapest && !cheapest.recommended) {
    cheapest.badge = '💰 Best Value';
  }

  // Add fastest badge
  const fastest = [...scored].sort((a, b) => (a.durationMin || 999) - (b.durationMin || 999))[0];
  if (fastest && !fastest.badge) {
    fastest.badge = '⚡ Fastest';
  }

  return scored;
}

module.exports = { scoreTransportOption, rankTransportOptions };
