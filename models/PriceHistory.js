const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
    hotelId: { type: String, required: true },
    price: { type: Number, required: true },
    currency: { type: String, default: 'EGP' },
    cityId: { type: String },
    timestamp: { type: Date, default: Date.now }
});

// Index for fast retrieval of latest prices and average calculation
priceHistorySchema.index({ hotelId: 1, timestamp: -1 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
