const mongoose = require('mongoose');

const transportOptionSchema = new mongoose.Schema({
  type:         { type: String, enum: ['flight', 'train', 'bus', 'car'], required: true },
  operator:     { type: String },
  origin:       { type: String, required: true },
  destination:  { type: String, required: true },
  cabinClass:   { type: String },
  priceEGP:     { type: Number, required: true },
  durationMin:  { type: Number },
  score:        { type: Number },
  recommended:  { type: Boolean, default: false },
  source:       { type: String, enum: ['amadeus', 'fallback', 'static'], default: 'static' },
  details:      { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const transportSearchSchema = new mongoose.Schema({
  userId:     { type: String, required: true },
  origin:     { type: String, required: true },
  destination: { type: String, required: true },
  date:       { type: String },
  travelStyle: { type: String, default: 'any' },
  budget:     { type: Number },
  results:    [transportOptionSchema],
  topPick:    { type: String }, // type of recommended option
  createdAt:  { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }, // 7 days TTL
});

transportSearchSchema.index({ userId: 1, createdAt: -1 });
transportSearchSchema.index({ origin: 1, destination: 1 });

module.exports = mongoose.model('TransportSearch', transportSearchSchema);
