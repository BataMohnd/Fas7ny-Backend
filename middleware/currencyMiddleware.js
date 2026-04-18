const geoip = require('geoip-lite');

// Simple exchange rate: 1 USD = 50 EGP (example rate)
const DEFAULT_USD_TO_EGP = 50.0;

exports.currencyMiddleware = (req, res, next) => {
    // 1. Get the IP (fallback for local testing)
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    
    // Extract first IP if multiple are forwarded
    if (ip.includes(',')) ip = ip.split(',')[0].trim();
    
    // In local development, loopback addresses might not resolve to an actual country
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('10.')) {
        console.log("🛠️ Local IP detected, defaulting to Egypt for testing.");
        req.userCurrency = 'EGP';
        req.userExchangeRate = 1; // Base rate
    } else {
        const geo = geoip.lookup(ip);
        if (geo && geo.country === 'EG') {
            req.userCurrency = 'EGP';
            req.userExchangeRate = 1;
        } else {
            req.userCurrency = 'USD';
            req.userExchangeRate = 1 / DEFAULT_USD_TO_EGP;
        }
    }
    
    // Attach a helper to format price
    req.formatPrice = (priceInEgp) => {
        if (req.userCurrency === 'USD') {
            return parseFloat((priceInEgp * req.userExchangeRate).toFixed(2));
        }
        return parseFloat(priceInEgp.toFixed(2));
    };

    next();
};
