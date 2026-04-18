const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'EGP' },
  status: { type: String, enum: ['success', 'pending', 'failed'], default: 'success' },
  type: { type: String, enum: ['top_up', 'payment', 'withdrawal'], required: true },
  description: { type: String },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
