const Rating = require('../models/Rating');
const Place = require('../models/Place');
const mongoose = require('mongoose');

exports.createRating = async (req, res) => {
  try {
    const { userId, placeId, placeType, rating, comment } = req.body;

    if (!userId || !placeId || !rating) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Upsert rating (if user already rated, update it)
    const updatedRating = await Rating.findOneAndUpdate(
      { userId, placeId },
      { userId, placeId, placeType, rating, comment, createdAt: new Date() },
      { upsert: true, new: true }
    );

    // Optional: Update Place model if it exists locally
    if (mongoose.Types.ObjectId.isValid(placeId)) {
      const summary = await Rating.aggregate([
        { $match: { placeId: placeId } },
        { 
          $group: { 
            _id: "$placeId", 
            avgRating: { $avg: "$rating" }, 
            count: { $sum: 1 } 
          } 
        }
      ]);

      if (summary.length > 0) {
        await Place.findByIdAndUpdate(placeId, {
          rating: summary[0].avgRating.toFixed(1),
          numberOfReviews: summary[0].count
        });
      }
    }

    res.status(201).json({ success: true, data: updatedRating });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getPlaceRatings = async (req, res) => {
  try {
    const { placeId } = req.params;
    const ratings = await Rating.find({ placeId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: ratings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getRatingSummary = async (req, res) => {
  try {
    const { placeId } = req.params;
    
    const summary = await Rating.aggregate([
      { $match: { placeId: placeId } },
      { 
        $group: { 
          _id: "$placeId", 
          averageRating: { $avg: "$rating" }, 
          ratingsCount: { $sum: 1 } 
        } 
      }
    ]);

    const recentReviews = await Rating.find({ placeId })
      .sort({ createdAt: -1 })
      .limit(3);

    if (summary.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          averageRating: 4.5, // Default for demo
          ratingsCount: 0,
          recentReviews: []
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        averageRating: parseFloat(summary[0].averageRating.toFixed(1)),
        ratingsCount: summary[0].ratingsCount,
        recentReviews
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
