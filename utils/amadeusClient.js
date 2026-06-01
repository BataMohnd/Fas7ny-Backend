/**
 * amadeusClient.js
 * Amadeus Flight Search integration with OAuth2 token caching.
 * Falls back to realistic Egyptian flight prices if API is unavailable.
 */

const axios = require('axios');
const NodeCache = require('node-cache');
const { toEGP } = require('./currencyConverter');

const tokenCache = new NodeCache({ stdTTL: 1700 }); // Amadeus tokens live 1800s
const AMADEUS_BASE = 'https://api.amadeus.com';

// Egyptian airport IATA codes
const EGYPT_IATA = {
  cairo:       'CAI',
  alexandria:  'HBE',
  hurghada:    'HRG',
  sharm:       'SSH',
  'sharm el sheikh': 'SSH',
  luxor:       'LXR',
  aswan:       'ASW',
  marsa:       'RMF',
  'marsa alam': 'RMF',
  borg:        'BOR',
  'borg el arab': 'BOR',
  taba:        'TCP',
};

// Fallback realistic prices EGP (one-way economy, 2025)
const FALLBACK_FLIGHTS = {
  'CAI-HRG': { price: 1800, duration: '1h 05m', airline: 'EgyptAir' },
  'CAI-SSH': { price: 1950, duration: '1h 10m', airline: 'EgyptAir' },
  'CAI-LXR': { price: 1650, duration: '1h 00m', airline: 'EgyptAir' },
  'CAI-ASW': { price: 1750, duration: '1h 15m', airline: 'EgyptAir' },
  'CAI-RMF': { price: 2100, duration: '1h 20m', airline: 'EgyptAir' },
  'CAI-HBE': { price: 1200, duration: '0h 45m', airline: 'EgyptAir' },
  'HRG-CAI': { price: 1800, duration: '1h 05m', airline: 'EgyptAir' },
  'SSH-CAI': { price: 1950, duration: '1h 10m', airline: 'EgyptAir' },
  'LXR-CAI': { price: 1650, duration: '1h 00m', airline: 'EgyptAir' },
  'ASW-CAI': { price: 1750, duration: '1h 15m', airline: 'EgyptAir' },
  'LXR-HRG': { price: 2200, duration: '1h 30m', airline: 'Air Arabia Egypt' },
  'HRG-LXR': { price: 2200, duration: '1h 30m', airline: 'Air Arabia Egypt' },
  'HRG-SSH': { price: 2400, duration: '1h 45m', airline: 'Fly Egypt' },
  'SSH-HRG': { price: 2400, duration: '1h 45m', airline: 'Fly Egypt' },
};

// ── Token Management ──────────────────────────────────────────────────────────

async function _getAccessToken() {
  const cached = tokenCache.get('amadeus_token');
  if (cached) return cached;

  const apiKey    = process.env.AMADEUS_API_KEY;
  const apiSecret = process.env.AMADEUS_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  try {
    const res = await axios.post(
      `${AMADEUS_BASE}/v1/security/oauth2/token`,
      new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     apiKey,
        client_secret: apiSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 }
    );
    const token = res.data?.access_token;
    if (token) {
      tokenCache.set('amadeus_token', token);
      return token;
    }
  } catch (err) {
    console.warn('[Amadeus] Token fetch failed:', err.message);
  }
  return null;
}

// ── IATA Resolution ───────────────────────────────────────────────────────────

function resolveIATA(cityName) {
  if (!cityName) return null;
  const key = cityName.toLowerCase().trim();
  return EGYPT_IATA[key] || cityName.toUpperCase().slice(0, 3);
}

// ── Flight Search ─────────────────────────────────────────────────────────────

/**
 * Search for flights using Amadeus API.
 * Falls back to realistic prices if API is unavailable.
 *
 * @param {string} origin       City name or IATA code
 * @param {string} destination  City name or IATA code
 * @param {string} date         ISO date (YYYY-MM-DD)
 * @param {number} adults       Number of passengers
 * @returns {Promise<Array>}    Array of flight offers
 */
async function searchFlights(origin, destination, date, adults = 1) {
  const originIATA = resolveIATA(origin);
  const destIATA   = resolveIATA(destination);

  if (!originIATA || !destIATA) {
    return _buildFallback(origin, destination, date, adults);
  }

  const token = await _getAccessToken();
  if (!token) {
    return _buildFallback(originIATA, destIATA, date, adults);
  }

  try {
    const res = await axios.get(
      `${AMADEUS_BASE}/v2/shopping/flight-offers`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          originLocationCode:      originIATA,
          destinationLocationCode: destIATA,
          departureDate:           date,
          adults:                  adults,
          currencyCode:            'USD',
          max:                     5,
        },
        timeout: 10000,
      }
    );

    const offers = res.data?.data || [];
    if (offers.length === 0) return _buildFallback(originIATA, destIATA, date, adults);

    // Transform Amadeus response to our unified format
    const results = [];
    for (const offer of offers.slice(0, 5)) {
      const itinerary = offer.itineraries?.[0];
      const segment   = itinerary?.segments?.[0];
      const priceUSD  = parseFloat(offer.price?.grandTotal || offer.price?.total || 0);
      const priceEGP  = await toEGP(priceUSD * adults, 'USD');

      results.push({
        flightNumber:   `${segment?.carrierCode || ''}${segment?.number || ''}`,
        airline:        segment?.carrierCode || 'Unknown',
        origin:         segment?.departure?.iataCode || originIATA,
        destination:    segment?.arrival?.iataCode   || destIATA,
        departureTime:  segment?.departure?.at || date,
        arrivalTime:    segment?.arrival?.at   || date,
        duration:       itinerary?.duration?.replace('PT', '').toLowerCase() || 'N/A',
        priceEGP,
        priceUSD:       priceUSD * adults,
        currency:       'EGP',
        cabinClass:     offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin || 'ECONOMY',
        seatsAvailable: offer.numberOfBookableSeats || null,
        source:         'amadeus',
      });
    }

    return results;
  } catch (err) {
    console.warn('[Amadeus] Flight search failed:', err.message);
    return _buildFallback(originIATA, destIATA, date, adults);
  }
}

// ── Fallback Builder ──────────────────────────────────────────────────────────

async function _buildFallback(origin, destination, date, adults = 1) {
  const key      = `${origin.toUpperCase()}-${destination.toUpperCase()}`;
  const revKey   = `${destination.toUpperCase()}-${origin.toUpperCase()}`;
  const template = FALLBACK_FLIGHTS[key] || FALLBACK_FLIGHTS[revKey];

  if (!template) {
    // Generic fallback: estimate ~1800 EGP base
    const basePrice = 1800;
    return [{
      flightNumber:   'MS000',
      airline:        'EgyptAir',
      origin:         origin.toUpperCase(),
      destination:    destination.toUpperCase(),
      departureTime:  `${date}T08:00:00`,
      arrivalTime:    `${date}T10:00:00`,
      duration:       '2h 00m',
      priceEGP:       basePrice * adults,
      priceUSD:       Math.round(basePrice / 49.5) * adults,
      currency:       'EGP',
      cabinClass:     'ECONOMY',
      seatsAvailable: null,
      source:         'fallback',
    }];
  }

  return [{
    flightNumber:   'MS' + Math.floor(Math.random() * 900 + 100),
    airline:        template.airline,
    origin:         origin.toUpperCase(),
    destination:    destination.toUpperCase(),
    departureTime:  `${date}T08:00:00`,
    arrivalTime:    `${date}T10:00:00`,
    duration:       template.duration,
    priceEGP:       template.price * adults,
    priceUSD:       Math.round(template.price / 49.5) * adults,
    currency:       'EGP',
    cabinClass:     'ECONOMY',
    seatsAvailable: null,
    source:         'fallback',
  }];
}

module.exports = { searchFlights, resolveIATA, EGYPT_IATA };
