const User = require('../models/User');
const nodemailer = require('nodemailer');

// 1. ميثود جلب البروفايل
exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findOne({ uid: req.params.id });
        if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });
        res.status(200).json({ status: 'success', data: user });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.getInterests = async (req, res) => {
    try {
        const user = await User.findOne({ uid: req.params.id }).select('interests');
        if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });
        res.status(200).json({ status: 'success', interests: user.interests || [] });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.updateProfileImageUrl = async (req, res) => {
    try {
        const { userId, imageUrl } = req.body;
        const updatedUser = await User.findOneAndUpdate(
            { uid: userId },
            { profileImageUrl: imageUrl },
            { new: true }
        );
        if (!updatedUser) return res.status(404).json({ status: 'fail', message: 'User not found' });
        res.status(200).json({ status: 'success', data: updatedUser });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.updateBalance = async (req, res) => {
    try {
        const { userId, amount } = req.body; 
        const updatedUser = await User.findOneAndUpdate(
            { uid: userId },
            { $inc: { walletBalance: amount } },
            { new: true }
        );
        res.status(200).json({ status: 'success', walletBalance: updatedUser.walletBalance });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.updateInterests = async (req, res) => {
    try {
        const { userId, interests } = req.body;
        const updatedUser = await User.findOneAndUpdate(
            { uid: userId },
            { interests: interests },
            { new: true }
        );

        if (!updatedUser) return res.status(404).json({ status: 'fail', message: 'User not found' });
        
        res.status(200).json({ status: 'success', data: updatedUser });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.syncUser = async (req, res) => {
    try {
        const { userId, name, email, profileImageUrl } = req.body;
        
        let user = await User.findOne({ uid: userId });
        
        if (!user) {
            user = new User({
                uid: userId,
                name: name || 'Google User',
                email: email || '',
                profileImageUrl: profileImageUrl || '',
                walletBalance: 500.0, // Default signup bonus setup
                preferredBudget: 0.0,
                interests: [],
                travelType: ''
            });
            await user.save();
        }
        res.status(200).json({ status: 'success', data: user });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        console.log('🔍 Searching for user with email:', email);
        const user = await User.findOne({ email: new RegExp(`^${email}$`, 'i') });
        if (!user) {
            console.log('❌ User not found in DB for email:', email);
            return res.status(404).json({ status: 'fail', message: 'User not found' });
        }
        
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 mins
        await user.save();
        
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Fas7ny Password Reset OTP',
            text: `Your OTP is ${otp}. It expires in 10 minutes.`
        });
        
        res.status(200).json({ status: 'success', message: 'OTP sent to email' });
    } catch (err) {
        res.status(500).json({ status: 'fail', message: err.message });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await User.findOne({ email, otp, otpExpiry: { $gt: Date.now() } });
        
        if (!user) return res.status(400).json({ status: 'fail', message: 'Invalid or expired OTP' });
        
        user.password = newPassword; 
        user.otp = null;
        user.otpExpiry = null;
        await user.save();
        
        res.status(200).json({ status: 'success', message: 'Password reset successful' });
    } catch (err) {
        res.status(500).json({ status: 'fail', message: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 3: Saved Places (MongoDB mirror of Firestore favorites)
// Used by the proactive suggestion algorithm server-side.
// Flutter uses Firestore as the real-time source; these endpoints sync to MongoDB.
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/users/:userId/saved  — add a place to savedPlaces
exports.addSavedPlace = async (req, res) => {
    try {
        const { userId } = req.params;
        const { placeId } = req.body;

        if (!placeId) return res.status(400).json({ status: 'fail', message: 'placeId is required' });

        // $addToSet prevents duplicates atomically
        const user = await User.findOneAndUpdate(
            { uid: userId },
            { $addToSet: { savedPlaces: placeId } },
            { new: true, upsert: false }
        );

        if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });

        console.log(`[Favorites] Added ${placeId} to ${userId}'s savedPlaces (${user.savedPlaces.length} total)`);
        res.status(200).json({ status: 'success', savedPlaces: user.savedPlaces });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

// DELETE /api/users/:userId/saved/:placeId  — remove a place
exports.removeSavedPlace = async (req, res) => {
    try {
        const { userId, placeId } = req.params;

        const user = await User.findOneAndUpdate(
            { uid: userId },
            { $pull: { savedPlaces: placeId } },
            { new: true }
        );

        if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });

        console.log(`[Favorites] Removed ${placeId} from ${userId}'s savedPlaces`);
        res.status(200).json({ status: 'success', savedPlaces: user.savedPlaces });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};

// GET /api/users/:userId/saved — fetch the full saved list
exports.getSavedPlaces = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findOne({ $or: [{ _id: userId }, { uid: userId }] });
    if (!user) return res.status(404).json({ message: 'User not found' });

    const savedIds = user.savedPlaces || [];
    console.log(`[SavedPlaces] User ${userId} has ${savedIds.length} saved IDs:`, savedIds);

    if (savedIds.length === 0) {
      return res.status(200).json({ success: true, savedPlaces: [] });
    }

    // Load ALL cache docs once
    const NearbyPlaceCache = require('../models/NearbyPlaceCache');
    const allCaches = await NearbyPlaceCache.find({}).lean();
    console.log(`[SavedPlaces] Total cache docs: ${allCaches.length}`);

    // Build a flat lookup map: id → place data
    const placeMap = {};
    for (const cache of allCaches) {
      for (const item of (cache.items || [])) {
        const id = item.id || item.placeId || item._id?.toString();
        if (id) placeMap[id] = { ...item, city: cache.city };
      }
    }
    console.log(`[SavedPlaces] Total cached places available: ${Object.keys(placeMap).length}`);

    // City image fallbacks per city name
    const cityImages = {
      'Cairo':          'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600',
      'Hurghada':       'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600',
      'Luxor':          'https://images.unsplash.com/photo-1539209581898-842e47c177af?w=600',
      'Aswan':          'https://images.unsplash.com/photo-1568322445389-f64ac2515020?w=600',
      'Sharm El-Sheikh':'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600',
      'Alexandria':     'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600',
      'Dahab':          'https://images.unsplash.com/photo-1544256241-11dcedfeb8f8?w=600',
    };

    // Category image fallbacks
    const categoryImages = {
      'restaurant': 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
      'cafe':       'https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=600',
      'activity':   'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600',
      'hotel':      'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600',
    };

    const enriched = savedIds.map(id => {
      const cached = placeMap[id];

      if (cached) {
        const city = cached.city || '';
        const type = cached.type || cached.category || 'activity';
        const imageUrl = cached.imageUrl ||
          cityImages[city] ||
          categoryImages[type] ||
          'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?w=600';

        return {
          id,
          name: cached.name || 'Saved Place',
          imageUrl,
          neighbourhood: cached.address || city || 'Egypt',
          city,
          price: cached.price || 0,
          rating: cached.rating || 4.0,
          latitude: cached.lat || cached.latitude,
          longitude: cached.lng || cached.longitude,
          category: type,
          source: 'google_places',
        };
      }

      // Not found in cache — return with unique placeholder based on ID hash
      const cityKeys = Object.keys(cityImages);
      const fallbackCity = cityKeys[id.charCodeAt(0) % cityKeys.length];
      return {
        id,
        name: 'Saved Place',
        imageUrl: cityImages[fallbackCity],
        neighbourhood: 'Tap to explore',
        city: fallbackCity,
        price: 0,
        rating: 4.0,
        source: 'saved',
      };
    });

    console.log(`[SavedPlaces] Enriched ${enriched.filter(e => e.name !== 'Saved Place').length}/${enriched.length} places`);
    return res.status(200).json({ success: true, savedPlaces: enriched });

  } catch (err) {
    console.error('[SavedPlaces] Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};