const mongoose = require('mongoose');

const PlaceCommentSchema = new mongoose.Schema({
  placeId:   { type: String, required: true, index: true },
  userId:    { type: String, required: true },
  userName:  { type: String, required: true },
  userPhoto: { type: String, default: '' },
  message:   { type: String, required: true, maxlength: 500 },
  rating:    { type: Number, min: 1, max: 5, default: null },
  likes:     { type: Number, default: 0 },
  likedBy:   [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('PlaceComment', PlaceCommentSchema);
