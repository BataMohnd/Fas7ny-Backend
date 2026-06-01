const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: { type: String },             // Firebase UID used as _id
  uid: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: '' },
  walletBalance: { type: Number, default: 0 },
  profileImage: { type: String, default: '' },
  profileImageUrl: { type: String, default: '' },

  // ── Preference & Interest data (written by Flutter on onboarding) ──────────
  interests: { type: [String], default: [] },          // e.g. ['beach', 'history', 'food']
  preferredBudget: { type: Number, default: 0 },
  travelType: { type: String, default: '' },           // e.g. 'solo', 'family', 'couple'

  // ── Favorites: synced from Firestore for server-side algorithm use ─────────
  // Primary source of truth is Firestore; this mirrors it for the suggestion engine
  savedPlaces: { type: [String], default: [] },        // array of placeIds / hotelIds

  // ── Legacy fields ──────────────────────────────────────────────────────────
  favorites: { type: [String], default: [] },

  // ── OTP for password reset ─────────────────────────────────────────────────
  otp: { type: String, default: null },
  otpExpiry: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);