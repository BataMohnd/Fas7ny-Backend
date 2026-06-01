/**
 * currencyConverter.js
 * Converts hotel/flight prices to EGP using live exchange rates.
 * Falls back to hardcoded rates if the API is unavailable.
 */

const axios = require('axios');
const NodeCache = require('node-cache');

// Cache rates for 6 hours
const rateCache = new NodeCache({ stdTTL: 6 * 60 * 60 });

// Fallback rates to EGP (updated May 2025)
const FALLBACK_RATES = {
  USD: 49.5,
  EUR: 53.8,
  GBP: 63.2,
  SAR: 13.2,
  AED: 13.5,
  EGP: 1.0,
  KWD: 161.0,
  BHD: 131.5,
  QAR: 13.6,
  OMR: 128.6,
  JOD: 69.8,
  TRY: 1.47,
};

/**
 * Fetches live exchange rates against EGP.
 * Uses ExchangeRate-API (free tier — 1500 req/month).
 * Falls back silently to FALLBACK_RATES.
 */
async function _fetchLiveRates() {
  try {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    if (!apiKey) return FALLBACK_RATES;

    const cached = rateCache.get('rates_egp');
    if (cached) return cached;

    const res = await axios.get(
      `https://v6.exchangerate-api.com/v6/${apiKey}/latest/EGP`,
      { timeout: 5000 }
    );

    if (res.data?.result === 'success') {
      // rates are relative to EGP as base — invert so we get "X per 1 EGP" → we need "EGP per X"
      // API gives: 1 EGP = 0.0202 USD → rates.USD = 0.0202 → to EGP: 1/0.0202 = 49.5
      const raw = res.data.conversion_rates;
      const toEgp = {};
      for (const [currency, rate] of Object.entries(raw)) {
        toEgp[currency] = rate > 0 ? 1 / rate : (FALLBACK_RATES[currency] || 1);
      }
      toEgp.EGP = 1.0;

      rateCache.set('rates_egp', toEgp);
      return toEgp;
    }
    return FALLBACK_RATES;
  } catch {
    return FALLBACK_RATES;
  }
}

/**
 * Converts an amount from sourceCurrency to EGP.
 * @param {number} amount
 * @param {string} sourceCurrency  ISO 4217 code (e.g. "USD")
 * @returns {Promise<number>} Amount in EGP, rounded to nearest integer
 */
async function toEGP(amount, sourceCurrency = 'EGP') {
  if (!amount || isNaN(amount)) return 0;
  const currency = (sourceCurrency || 'EGP').toUpperCase();
  if (currency === 'EGP') return Math.round(amount);

  const rates = await _fetchLiveRates();
  const rate = rates[currency] || FALLBACK_RATES[currency] || 1;
  return Math.round(amount * rate);
}

/**
 * Normalizes a hotel price field to EGP.
 * Accepts: { price, currency } or { price_usd } or just a number.
 * @param {object|number} priceData
 * @returns {Promise<{priceEGP: number, originalPrice: number, originalCurrency: string}>}
 */
async function normalizeHotelPrice(priceData) {
  if (!priceData) return { priceEGP: 0, originalPrice: 0, originalCurrency: 'EGP' };

  let amount = 0;
  let currency = 'EGP';

  if (typeof priceData === 'number') {
    amount = priceData;
    currency = 'EGP';
  } else if (typeof priceData === 'object') {
    amount = priceData.price || priceData.price_usd || priceData.amount || priceData.value || 0;
    currency = priceData.currency || priceData.currency_code || (priceData.price_usd ? 'USD' : 'EGP');
  }

  const priceEGP = await toEGP(amount, currency);
  return { priceEGP, originalPrice: amount, originalCurrency: currency.toUpperCase() };
}

/**
 * Formats EGP price as a human-readable string.
 * e.g. 1500 → "1,500 EGP/night"
 */
function formatEGP(amount, suffix = '/night') {
  if (!amount) return 'N/A';
  return `${Number(amount).toLocaleString('en-EG')} EGP${suffix}`;
}

module.exports = { toEGP, normalizeHotelPrice, formatEGP, FALLBACK_RATES };
