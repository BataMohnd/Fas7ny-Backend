const mongoose = require('mongoose');

const UserPlaceSchema = new mongoose.Schema({
  // Owner info
  ownerId:        { type: String, required: true },
  ownerName:      { type: String, required: true },
  ownerPhone:     { type: String, required: true },
  bankAccount:    { type: String, required: true },

  // Place details
  name:           { type: String, required: true },
  description:    { type: String, required: true },
  category:       { type: String, enum: ['hotel', 'restaurant', 'cafe', 'activity', 'other'], default: 'other' },
  price:          { type: Number, required: true, min: 0 },
  currency:       { type: String, default: 'EGP' },

  // Location
  address:        { type: String },
  city:           { type: String },
  lat:            { type: Number },
  lng:            { type: Number },
  locationSource: { type: String, enum: ['gps', 'manual'], default: 'manual' },

  // Photos (base64 strings or URLs)
  photos:         [{ type: String }],
  mainPhoto:      { type: String },

  // Status (admin review flow)
  status:         { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  isActive:       { type: Boolean, default: true },

  // Ratings
  rating:         { type: Number, default: 0 },
  reviewCount:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('UserPlace', UserPlaceSchema);
