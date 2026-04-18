const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: { type: String }, // Explicitly allow String IDs (Firebase UIDs)
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  uid: { type: String, required: true, unique: true }, // Added for Firebase UID
  password: { type: String, required: true },
  walletBalance: { type: Number, default: 0 },
  profileImage: { type: String, default: "" },
  profileImageUrl: { type: String, default: "" }, // Added for Firebase Storage URL
  favorites: [{ type: String }], // Changed to String to accommodate UIDs or mixed refs
  interests: { type: [String], default: [] },
  otp: { type: String, default: null },
  otpExpiry: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);