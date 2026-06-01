const UserPlace = require('../models/UserPlace');
const Booking   = require('../models/Booking');
const User      = require('../models/User');

// ── POST /api/user-places/add ──────────────────────────────────────────────
exports.addPlace = async (req, res) => {
  try {
    console.log('[UserPlace] Request received. Fields:', Object.keys(req.body));
    console.log('[UserPlace] Photos count:', req.body.photos?.length ?? 0);

    const {
      ownerId, ownerName, ownerPhone, bankAccount,
      name, description, category, price,
      address, city, lat, lng, locationSource,
      photos, mainPhoto,
    } = req.body;

    if (!ownerId || !name || !price || !ownerPhone || !bankAccount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: ownerId, name, price, ownerPhone, bankAccount',
      });
    }

    const place = new UserPlace({
      ownerId,
      ownerName:     ownerName || '',
      ownerPhone,
      bankAccount,
      name,
      description:   description || '',
      category:      category || 'other',
      price:         Number(price),
      address:       address || '',
      city:          city || '',
      lat:           lat || null,
      lng:           lng || null,
      locationSource: locationSource || 'manual',
      photos:        photos || [],
      mainPhoto:     mainPhoto || (photos?.[0] ?? ''),
      status:        'approved', // ← auto-approve immediately
      isActive:      true,
    });

    await place.save();
    console.log(`[UserPlace] ✅ Auto-approved: "${name}" by ${ownerId}`);
    res.status(201).json({
      success: true,
      message: 'Place submitted successfully!',
      data: place,
    });
  } catch (err) {
    console.error('[UserPlace] FULL ERROR:', err.stack);
    res.status(500).json({ success: false, message: err.message, stack: err.stack });
  }
};

// ── GET /api/user-places/my/:ownerId ──────────────────────────────────────
exports.getMyPlaces = async (req, res) => {
  try {
    const places = await UserPlace
      .find({ ownerId: req.params.ownerId })
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: places.length, data: places });
  } catch (err) {
    console.error('[UserPlace] ❌ getMyPlaces error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/user-places/all (public — approved only) ─────────────────────
exports.getAllPlaces = async (req, res) => {
  try {
    const places = await UserPlace
      .find({ status: 'approved', isActive: true })
      .sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: places.length, data: places });
  } catch (err) {
    console.error('[UserPlace] ❌ getAllPlaces error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/user-places/:placeId/bookings ────────────────────────────────
// Returns all bookings for a user-owned place, enriched with customer info
exports.getPlaceBookings = async (req, res) => {
  try {
    const { placeId } = req.params;

    const bookings = await Booking.find({
      placeId: placeId,
      status: { $in: ['confirmed', 'active', 'pending', 'cancelled'] },
    }).sort({ createdAt: -1 }).lean();

    const enriched = await Promise.all(bookings.map(async (booking) => {
      try {
        const user = await User.findOne({
          $or: [{ uid: booking.userId }, { _id: booking.userId }],
        }).select('name email profileImageUrl').lean();

        return {
          ...booking,
          customer: {
            name:  user?.name  || 'Unknown Customer',
            email: user?.email || '',
            photo: user?.profileImageUrl || '',
            id:    booking.userId,
          },
        };
      } catch (e) {
        return { ...booking, customer: { name: 'Unknown', email: '', photo: '', id: booking.userId } };
      }
    }));

    console.log(`[UserPlace] ${enriched.length} bookings for place ${placeId}`);
    res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/user-places/bookings/:bookingId/status ─────────────────────
// Owner accepts or rejects a booking
exports.updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, ownerId } = req.body;

    if (!['confirmed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Status must be confirmed or cancelled' });
    }

    const booking = await Booking.findByIdAndUpdate(
      bookingId,
      { status },
      { new: true }
    );

    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Notify customer via Firestore real-time
    const admin = require('firebase-admin');
    try {
      await admin.firestore()
        .collection('bookingUpdates')
        .doc(bookingId)
        .set({
          bookingId,
          status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          customerId: booking.userId,
        });
    } catch (e) {
      console.warn('[UserPlace] Firestore notify failed:', e.message);
    }

    console.log(`[UserPlace] Booking ${bookingId} → ${status} by owner ${ownerId}`);
    res.status(200).json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/user-places/:id ───────────────────────────────────────────
exports.deletePlace = async (req, res) => {
  try {
    const deleted = await UserPlace.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Place not found' });
    }
    res.status(200).json({ success: true, message: 'Place deleted successfully' });
  } catch (err) {
    console.error('[UserPlace] ❌ deletePlace error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/user-places/:id/status (admin use) ─────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }
    const place = await UserPlace.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!place) {
      return res.status(404).json({ success: false, message: 'Place not found' });
    }
    res.status(200).json({ success: true, data: place });
  } catch (err) {
    console.error('[UserPlace] ❌ updateStatus error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
