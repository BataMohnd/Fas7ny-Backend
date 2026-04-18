const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  hotelId: { type: String }, 
  cityId: { type: String },  
  hotelName: { type: String, required: true },
  mainPhotoUrl: { type: String },
  address: { type: String },
  city: { type: String },
  price: { type: Number },
  currency: { type: String, default: 'EGP' },
  reviewScore: { type: Number },
  rating: { type: Number, default: 0.0 }, // Added for UI synchronization
  reviewCount: { type: Number },
  latitude: { type: Number },
  longitude: { type: Number },
  description: { type: String },
  room_type: { type: String, default: "" }, // Added for search
  category: { type: String, default: 'Hotels' }
}, { timestamps: true });

module.exports = mongoose.model('Hotel', hotelSchema);