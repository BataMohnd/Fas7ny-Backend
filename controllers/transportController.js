/**
 * transportController.js
 * Handles transport search and smart ranking.
 *
 * Routes:
 *   GET  /api/transport/options?from=cairo&to=luxor&date=2025-08-01&adults=2&style=family&budget=5000
 *   POST /api/transport/smart
 *   GET  /api/transport/flights?from=cairo&to=luxor&date=2025-08-01&adults=1
 */

const { searchFlights }       = require('../utils/amadeusClient');
const { findTrainRoute, findBusRoutes, estimateCarCost, getDistance } = require('../utils/transportData');
const { rankTransportOptions } = require('../utils/transportAlgorithm');
const TransportSearch          = require('../models/Transport');

// ── /search helpers ───────────────────────────────────────────────────────────

function normalizeCity(city = '') {
  if (!city || typeof city !== 'string') return '';
  return city.trim().toLowerCase()
    .replace(/^(مدينة|محافظة|مطار)\s+/, '')
    .replace('sharm el-sheikh', 'شرم الشيخ')
    .replace('sharm el sheikh', 'شرم الشيخ')
    .replace('cairo', 'القاهرة')
    .replace('alexandria', 'الإسكندرية')
    .replace('hurghada', 'الغردقة')
    .replace('luxor', 'الأقصر')
    .replace('aswan', 'أسوان')
    .replace('dahab', 'دهب');
}

function getRecommended(cheapestTrain, cheapestBus, cheapestFlight) {
  if (cheapestBus !== null)    return { type: 'bus',    reason: 'الأتوبيس أرخص وأوفر خيار',    price: cheapestBus };
  if (cheapestTrain !== null)  return { type: 'train',  reason: 'القطار مريح وبسعر معقول',      price: cheapestTrain };
  if (cheapestFlight !== null) return { type: 'flight', reason: 'الطيران أسرع وسيلة',           price: cheapestFlight };
  return { type: 'bus', reason: 'الأتوبيس متاح دائماً' };
}

// ── Static fallback data ───────────────────────────────────────────────────────

const _STATIC_TRAINS = [
  // Cairo ↔ Alexandria
  { type: 'train', operator: 'ENR - القطر الإسباني', origin: 'القاهرة', destination: 'الإسكندرية', price: 120, cabinClass: 'درجة أولى',   duration: '2س 15د',   departureTime: '08:00', arrivalTime: '10:15', amenities: ['تكييف', 'مقاعد مريحة'], seatsLeft: null },
  { type: 'train', operator: 'ENR - توربيني',         origin: 'القاهرة', destination: 'الإسكندرية', price: 80,  cabinClass: 'درجة ثانية', duration: '2س 30د',   departureTime: '09:30', arrivalTime: '12:00', amenities: ['تكييف'],                 seatsLeft: null },
  { type: 'train', operator: 'ENR',                    origin: 'القاهرة', destination: 'الإسكندرية', price: 45,  cabinClass: 'درجة ثالثة', duration: '2س 45د',   departureTime: '11:00', arrivalTime: '13:45', amenities: [],                        seatsLeft: null },
  // Cairo ↔ Luxor
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'الأقصر', price: 220, cabinClass: 'درجة أولى',   duration: '10 ساعات',  departureTime: '20:00', arrivalTime: '06:00', amenities: ['تكييف'],                      seatsLeft: null },
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'الأقصر', price: 750, cabinClass: 'نوم ديلوكس', duration: '10 ساعات',  departureTime: '21:00', arrivalTime: '07:00', amenities: ['سرير', 'وجبة', 'تكييف'],      seatsLeft: 4    },
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'الأقصر', price: 145, cabinClass: 'درجة ثانية', duration: '10 ساعات',  departureTime: '19:30', arrivalTime: '05:30', amenities: ['تكييف'],                      seatsLeft: null },
  // Cairo ↔ Aswan
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'أسوان', price: 270, cabinClass: 'درجة أولى',   duration: '12 ساعة',   departureTime: '19:00', arrivalTime: '07:00', amenities: ['تكييف'],                      seatsLeft: null },
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'أسوان', price: 900, cabinClass: 'نوم ديلوكس', duration: '12 ساعة',   departureTime: '20:00', arrivalTime: '08:00', amenities: ['سرير', 'وجبة', 'تكييف'],      seatsLeft: 2    },
  // Luxor ↔ Aswan
  { type: 'train', operator: 'ENR', origin: 'الأقصر',  destination: 'أسوان',        price: 75,  cabinClass: 'درجة أولى',  duration: '3 ساعات',  departureTime: '09:00', arrivalTime: '12:00', amenities: ['تكييف'], seatsLeft: null },
  // Cairo ↔ Port Said
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'بورسعيد',      price: 55,  cabinClass: 'درجة أولى',  duration: '3 ساعات',  departureTime: '08:30', arrivalTime: '11:30', amenities: ['تكييف'], seatsLeft: null },
  { type: 'train', operator: 'ENR', origin: 'القاهرة', destination: 'الإسماعيلية',  price: 45,  cabinClass: 'درجة أولى',  duration: '2 ساعات',  departureTime: '09:00', arrivalTime: '11:00', amenities: ['تكييف'], seatsLeft: null },
];

const _STATIC_BUSES = [
  // Cairo → Hurghada
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'الغردقة',    price: 220, cabinClass: 'VIP',    duration: '5 ساعات',   departureTime: '07:00', arrivalTime: '12:00', amenities: ['تكييف', 'واي فاي', 'وجبة خفيفة'], seatsLeft: 12 },
  { type: 'bus', operator: 'Superjet',          origin: 'القاهرة', destination: 'الغردقة',    price: 200, cabinClass: 'عادي',   duration: '5 ساعات',   departureTime: '08:00', arrivalTime: '13:00', amenities: ['تكييف'],                           seatsLeft: 8  },
  { type: 'bus', operator: 'Upper Egypt Bus',   origin: 'القاهرة', destination: 'الغردقة',    price: 180, cabinClass: 'عادي',   duration: '5س 30د',    departureTime: '09:00', arrivalTime: '14:30', amenities: ['تكييف'],                           seatsLeft: null },
  // Cairo → Sharm El-Sheikh
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'شرم الشيخ',  price: 185, cabinClass: 'VIP',    duration: '6 ساعات',   departureTime: '07:30', arrivalTime: '13:30', amenities: ['تكييف', 'واي فاي'],                seatsLeft: 5  },
  { type: 'bus', operator: 'Upper Egypt Bus',   origin: 'القاهرة', destination: 'شرم الشيخ',  price: 140, cabinClass: 'عادي',   duration: '6 ساعات',   departureTime: '09:00', arrivalTime: '15:00', amenities: ['تكييف'],                           seatsLeft: null },
  // Cairo → Dahab
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'دهب',         price: 240, cabinClass: 'VIP',    duration: '7 ساعات',   departureTime: '08:00', arrivalTime: '15:00', amenities: ['تكييف', 'واي فاي'],                seatsLeft: 6  },
  // Cairo → Alexandria
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'الإسكندرية', price: 75,  cabinClass: 'VIP',    duration: '2س 30د',    departureTime: '07:00', arrivalTime: '09:30', amenities: ['تكييف', 'واي فاي'],                seatsLeft: null },
  { type: 'bus', operator: 'Superjet',          origin: 'القاهرة', destination: 'الإسكندرية', price: 60,  cabinClass: 'عادي',   duration: '2س 30د',    departureTime: '08:00', arrivalTime: '10:30', amenities: ['تكييف'],                           seatsLeft: null },
  // Cairo → Luxor
  { type: 'bus', operator: 'Upper Egypt Bus',   origin: 'القاهرة', destination: 'الأقصر',     price: 180, cabinClass: 'عادي',   duration: '9 ساعات',   departureTime: '19:00', arrivalTime: '04:00', amenities: ['تكييف'],                           seatsLeft: null },
  // Cairo → Aswan
  { type: 'bus', operator: 'Upper Egypt Bus',   origin: 'القاهرة', destination: 'أسوان',       price: 220, cabinClass: 'عادي',   duration: '11 ساعة',   departureTime: '18:00', arrivalTime: '05:00', amenities: ['تكييف'],                           seatsLeft: null },
  // Cairo → Marsa Alam
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'مرسى علم',    price: 280, cabinClass: 'VIP',    duration: '7 ساعات',   departureTime: '08:00', arrivalTime: '15:00', amenities: ['تكييف', 'واي فاي'],                seatsLeft: 10 },
  // Cairo → Port Said
  { type: 'bus', operator: 'GoBus',            origin: 'القاهرة', destination: 'بورسعيد',     price: 75,  cabinClass: 'VIP',    duration: '2س 30د',    departureTime: '09:00', arrivalTime: '11:30', amenities: ['تكييف', 'واي فاي'],                seatsLeft: null },
];

const _STATIC_CAR_RENTALS = [
  { type: 'car_rental', operator: 'اقتصادي',  origin: '', destination: '', price: 350, cabinClass: 'اقتصادي', duration: null, departureTime: null, arrivalTime: null, amenities: ['تأمين', 'GPS'],                    seatsLeft: null },
  { type: 'car_rental', operator: 'ستاندرد',  origin: '', destination: '', price: 500, cabinClass: 'ستاندرد', duration: null, departureTime: null, arrivalTime: null, amenities: ['تأمين', 'GPS', 'مقعد أطفال'],      seatsLeft: null },
  { type: 'car_rental', operator: 'SUV فاخر', origin: '', destination: '', price: 800, cabinClass: 'SUV',     duration: null, departureTime: null, arrivalTime: null, amenities: ['تأمين', 'GPS', '4WD', 'تبريد إضافي'], seatsLeft: null },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildTrainOptions(trainRoute) {
  if (!trainRoute) return [];
  const opts = [];
  for (const [cls, price] of Object.entries(trainRoute.classes)) {
    opts.push({
      type:        'train',
      operator:    'ENR',
      origin:      trainRoute.from,
      destination: trainRoute.to,
      cabinClass:  cls,
      priceEGP:    price,
      durationMin: trainRoute.durationMin,
      source:      'static',
      details: {
        trainTypes: trainRoute.trainTypes,
        operatorFull: 'Egyptian National Railways',
        bookingNote: 'Book at any ENR station or enr.gov.eg',
      },
    });
  }
  return opts;
}

function _buildBusOptions(busOps, from, to) {
  return busOps.map(op => ({
    type:        'bus',
    operator:    op.name,
    origin:      from,
    destination: to,
    cabinClass:  op.class,
    priceEGP:    op.price,
    durationMin: op.durationMin,
    source:      'static',
    details: {
      bookingNote: `Book at ${op.name} station or website`,
    },
  }));
}

function _buildCarOptions(from, to) {
  const types = ['economy', 'standard', 'suv'];
  return types.map(t => {
    const est = estimateCarCost(from, to, t);
    if (!est) return null;
    return {
      type:        'car',
      operator:    'Self-Drive / Rental',
      origin:      from,
      destination: to,
      cabinClass:  t,
      priceEGP:    est.estimatedCostEGP,
      durationMin: est.distanceKm ? Math.round((est.distanceKm / 100) * 60) : null,
      source:      'static',
      details: {
        model: est.model,
        distanceKm: est.distanceKm,
        breakdown: est.breakdown,
        bookingNote: 'Available on Careem, Uber, or local rental companies',
      },
    };
  }).filter(Boolean);
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * GET /api/transport/options
 * Returns all transport modes (flight, train, bus, car) ranked by smart score.
 */
exports.getTransportOptions = async (req, res) => {
  try {
    const {
      from, to, date,
      adults  = 1,
      style   = 'any',
      budget  = 0,
      userId,
    } = req.query;

    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to are required' });
    }

    const fromNorm = (from || '').toLowerCase().trim();
    const toNorm   = (to   || '').toLowerCase().trim();
    const distKm   = getDistance(fromNorm, toNorm) || 0;
    const travelDate = date || new Date().toISOString().slice(0, 10);
    const adultsNum  = parseInt(adults) || 1;
    const budgetNum  = parseFloat(budget) || 0;

    // Fetch all in parallel
    const [flights, trainRoute, busOps] = await Promise.all([
      searchFlights(fromNorm, toNorm, travelDate, adultsNum),
      Promise.resolve(findTrainRoute(fromNorm, toNorm)),
      Promise.resolve(findBusRoutes(fromNorm, toNorm)),
    ]);

    // Build option arrays
    const flightOpts = (flights || []).map(f => ({ ...f, type: 'flight' }));
    const trainOpts  = _buildTrainOptions(trainRoute);
    const busOpts    = _buildBusOptions(busOps, fromNorm, toNorm);
    const carOpts    = _buildCarOptions(fromNorm, toNorm);

    // Multiply per-person prices for multi-passenger
    const allOptions = [
      ...flightOpts,
      ...trainOpts.map(o => ({ ...o, priceEGP: o.priceEGP * adultsNum })),
      ...busOpts.map(o   => ({ ...o, priceEGP: o.priceEGP * adultsNum })),
      ...carOpts, // car is already per-trip
    ];

    // Rank using smart algorithm
    const ctx = { totalBudgetEGP: budgetNum, distanceKm: distKm, travelStyle: style };
    const ranked = rankTransportOptions(allOptions, ctx);

    const topPick = ranked[0]?.type || null;

    // Persist search result (best-effort, non-blocking)
    if (userId) {
      TransportSearch.create({
        userId, origin: fromNorm, destination: toNorm,
        date: travelDate, travelStyle: style, budget: budgetNum,
        results: ranked.slice(0, 10),
        topPick,
      }).catch(() => {});
    }

    return res.json({
      success: true,
      from: fromNorm,
      to: toNorm,
      distanceKm,
      adults: adultsNum,
      date: travelDate,
      topPick,
      options: ranked,
    });
  } catch (err) {
    console.error('[Transport] getTransportOptions error:', err);
    return res.status(500).json({ success: false, message: 'Transport search failed', error: err.message });
  }
};

/**
 * POST /api/transport/smart
 * Body: { from, to, date, adults, travelStyle, budget, userId }
 * Same logic as GET but accepts body params (useful for complex requests).
 */
exports.getSmartTransport = async (req, res) => {
  req.query = { ...req.query, ...req.body };
  return exports.getTransportOptions(req, res);
};

/**
 * GET /api/transport/flights
 * Flights only — quick access for Flight Search Screen.
 */
exports.getFlights = async (req, res) => {
  try {
    const { from, to, date, adults = 1 } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to are required' });
    }

    const travelDate = date || new Date().toISOString().slice(0, 10);
    const flights    = await searchFlights(from, to, travelDate, parseInt(adults) || 1);

    return res.json({
      success: true,
      flights: flights.map(f => ({ ...f, type: 'flight' })),
    });
  } catch (err) {
    console.error('[Transport] getFlights error:', err);
    return res.status(500).json({ success: false, message: 'Flight search failed', error: err.message });
  }
};

/**
 * GET /api/transport/trains
 * Trains only — for Train Booking Screen.
 */
exports.getTrains = async (req, res) => {
  try {
    const { from, to, adults = 1 } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to are required' });
    }

    const route = findTrainRoute(from.toLowerCase(), to.toLowerCase());
    if (!route) {
      return res.json({ success: true, trains: [], message: 'No direct train route found' });
    }

    const trains = _buildTrainOptions(route).map(o => ({
      ...o,
      priceEGP: o.priceEGP * (parseInt(adults) || 1),
    }));

    return res.json({ success: true, trains });
  } catch (err) {
    console.error('[Transport] getTrains error:', err);
    return res.status(500).json({ success: false, message: 'Train search failed', error: err.message });
  }
};

/**
 * GET /api/transport/buses
 * Buses only.
 */
exports.getBuses = async (req, res) => {
  try {
    const { from, to, adults = 1 } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to are required' });
    }

    const busOps = findBusRoutes(from.toLowerCase(), to.toLowerCase());
    if (busOps.length === 0) {
      return res.json({ success: true, buses: [], message: 'No direct bus route found' });
    }

    const buses = _buildBusOptions(busOps, from, to).map(o => ({
      ...o,
      priceEGP: o.priceEGP * (parseInt(adults) || 1),
    }));

    return res.json({ success: true, buses });
  } catch (err) {
    console.error('[Transport] getBuses error:', err);
    return res.status(500).json({ success: false, message: 'Bus search failed', error: err.message });
  }
};

/**
 * GET /api/transport/search?origin=القاهرة&destination=الغردقة&type=all&date=2025-08-01
 * Mobile-friendly endpoint — always returns a valid JSON response, never 500.
 * Uses static data with robust try/catch at every layer.
 */
exports.searchTransport = async function searchTransport(req, res) {
  try {
    const { origin = 'القاهرة', destination, type = 'all', date } = req.query;

    if (!destination) {
      return res.status(400).json({ success: false, error: 'destination required' });
    }

    const normOrigin = normalizeCity(origin);
    const normDest   = normalizeCity(destination);
    const results    = { trains: [], buses: [], flights: [], carRentals: [], summary: {} };

    // ── Trains ───────────────────────────────────────────────────────────────
    if (type === 'all' || type === 'train') {
      try {
        results.trains = _STATIC_TRAINS.filter(t =>
          (normalizeCity(t.origin).includes(normOrigin) || normOrigin.includes(normalizeCity(t.origin))) &&
          (normalizeCity(t.destination).includes(normDest) || normDest.includes(normalizeCity(t.destination)))
        ).sort((a, b) => a.price - b.price);
      } catch (e) {
        results.trains = [];
      }
    }

    // ── Buses ────────────────────────────────────────────────────────────────
    if (type === 'all' || type === 'bus') {
      try {
        results.buses = _STATIC_BUSES.filter(b =>
          (normalizeCity(b.origin).includes(normOrigin) || normOrigin.includes(normalizeCity(b.origin))) &&
          (normalizeCity(b.destination).includes(normDest) || normDest.includes(normalizeCity(b.destination)))
        ).sort((a, b) => a.price - b.price);
      } catch (e) {
        results.buses = [];
      }
    }

    // ── Flights ──────────────────────────────────────────────────────────────
    if (type === 'all' || type === 'flight') {
      try {
        const travelDate = date || new Date().toISOString().slice(0, 10);
        const flights    = await searchFlights(origin, destination, travelDate, 1);
        results.flights  = (flights || []).map(f => ({ ...f, type: 'flight' }));
      } catch (e) {
        results.flights = [];
      }
    }

    // ── Car Rentals ──────────────────────────────────────────────────────────
    if (type === 'all' || type === 'car_rental') {
      results.carRentals = _STATIC_CAR_RENTALS;
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const cheapestTrain  = results.trains[0]?.price  ?? null;
    const cheapestBus    = results.buses[0]?.price   ?? null;
    const cheapestFlight = results.flights[0]?.priceEGP || results.flights[0]?.price || null;

    results.summary = {
      origin, destination,
      hasTrains:  results.trains.length > 0,
      hasBuses:   results.buses.length > 0,
      hasFlights: results.flights.length > 0,
      cheapestTrain, cheapestBus, cheapestFlight,
      recommended: getRecommended(cheapestTrain, cheapestBus, cheapestFlight),
    };

    return res.json({ success: true, ...results });

  } catch (err) {
    console.error('searchTransport error:', err);
    // Never crash — always return something useful
    return res.json({
      success: true,
      trains:     _STATIC_TRAINS.slice(0, 2),
      buses:      _STATIC_BUSES.slice(0, 3),
      flights:    [],
      carRentals: _STATIC_CAR_RENTALS,
      summary: {
        origin:      req.query.origin      || 'القاهرة',
        destination: req.query.destination || '',
        recommended: { type: 'bus', reason: 'الأتوبيس متاح دائماً' },
      },
    });
  }
};
