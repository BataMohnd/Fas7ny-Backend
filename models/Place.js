const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema({
    name: { type: String, default: "Unnamed Place" },
    description: { type: String, default: "" },
    price: { type: Number, default: 0 },
    neighbourhood: { type: String, default: "Unknown" },
    imageUrl: { type: String, default: "" },
    category: { type: String, default: 'General' },
    room_type: { type: String, default: "" }, // Added for search
    rating: { type: Number, default: 0 },
    numberOfReviews: { type: Number, default: 0 },
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number] } // [longitude, latitude]
    },
    sentimentSummary: { type: String, default: null },
    city: { type: String, default: "" } // Added for city-based filtering
});

// Create the Geospatial Index for the Nearest Neighbor search
placeSchema.index({ location: '2dsphere' });

// Architecture Advice: Indexes for efficient searching and sorting by budget
placeSchema.index({ city: 1, price: 1 });
placeSchema.index({ city: 1, category: 1, price: 1 });

module.exports = mongoose.model('Place', placeSchema);