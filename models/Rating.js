const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  placeId: { type: String, required: true }, // Can be MongoDB ID or Google Place ID
  placeType: { 
    type: String, 
    required: true,
    enum: ['restaurant', 'cafe', 'attraction', 'activity', 'hotel']
  },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

// Index for fast lookups
ratingSchema.index({ placeId: 1 });
ratingSchema.index({ userId: 1, placeId: 1 }, { unique: true }); // Prevent multiple ratings from same user for same place

module.exports = mongoose.model('Rating', ratingSchema);
