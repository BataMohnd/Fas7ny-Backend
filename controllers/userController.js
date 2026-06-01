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

// GET /api/users/:userId/saved  — fetch the full saved list
exports.getSavedPlaces = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findOne({ uid: userId }).select('savedPlaces');

        if (!user) return res.status(404).json({ status: 'fail', message: 'User not found' });

        res.status(200).json({ status: 'success', savedPlaces: user.savedPlaces || [] });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};