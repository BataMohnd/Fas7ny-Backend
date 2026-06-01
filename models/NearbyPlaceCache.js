const mongoose = require('mongoose');

const nearbyPlaceCacheSchema = new mongoose.Schema({
    queryKey: {
        type: String,
        required: true,
        index: true
    },
    city: {
        type: String,
        default: 'custom'
    },
    category: {
        type: String,
        default: 'all'
    },
    center: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [lng, lat]
            required: true
        }
    },
    items: {
        type: Array,
        default: []
    },
    fetchedAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        required: true,
        index: { expires: 0 } // TTL index based on the date value in expiresAt
    }
}, { timestamps: true });

// Add spatial index for geo-queries
nearbyPlaceCacheSchema.index({ center: '2dsphere' });

module.exports = mongoose.model('NearbyPlaceCache', nearbyPlaceCacheSchema);
