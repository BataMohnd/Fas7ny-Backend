const mongoose = require('mongoose');

const SmartPlanSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  city: { type: String, required: true },
  days: { type: Number, required: true },
  walletBalance: { type: Number, required: true },
  totalEstimatedCost: { type: Number, required: true },
  planTitle: { type: String, required: true },
  planData: { type: Object, required: true }, // Full Gemini JSON response
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SmartPlan', SmartPlanSchema);
