const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  hotelId: { type: String, required: true },
  hotelName: { type: String },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  mealPlan: {
    type: String,
    enum: ['room_only', 'half_board', 'full_board'],
    default: 'room_only'
  },
  extraServices: [{ type: String }],
  totalPrice: { type: Number, required: true },
  currency: { type: String, default: 'EGP' },
  status: {
    type: String,
    enum: ['active', 'pending', 'confirmed', 'cancelled', 'completed'],
    default: 'active'
  }
}, { timestamps: true });

module.exports = mongoose.model('Booking', bookingSchema);
