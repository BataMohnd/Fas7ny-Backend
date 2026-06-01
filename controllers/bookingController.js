const Booking = require('../models/Booking');
const User = require('../models/User');
const { sendPushNotification } = require('../utils/notificationService');
const { sendBookingEmail } = require('../services/emailService');
const PriceHistory = require('../models/PriceHistory');

/**
 * Creates a new booking and sends a confirmation notification.
 * Now handles wallet payments and generic place types.
 */
exports.createBooking = async (req, res) => {
    console.log("📥 [BookingController] Incoming Booking Request:", JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            userId, 
            placeId, 
            placeName, 
            checkIn, 
            checkOut, 
            bookingTime, 
            totalPrice, 
            currency, 
            status, 
            placeType,
            paymentMethod,
            source,
            interestTags
        } = req.body;

        // 1. Validation
        if (!userId || !placeId || !totalPrice) {
            console.error("❌ [BookingController] Missing required fields:", { userId, placeId, totalPrice });
            return res.status(400).json({ 
                success: false, 
                message: "Missing required fields: userId, placeId, and totalPrice are mandatory." 
            });
        }

        // 2. Wallet Logic (If paymentMethod is Wallet)
        let updatedBalance;
        if (paymentMethod === 'Wallet') {
            console.log(`💳 [BookingController] Processing Wallet Payment for User: ${userId}`);
            
            const { processWalletPayment } = require('../services/walletService');
            const paymentResult = await processWalletPayment(userId, totalPrice, null);

            if (!paymentResult.success) {
                return res.status(paymentResult.message.includes('not found') ? 404 : 400).json({ 
                    success: false, 
                    message: paymentResult.message 
                });
            }
            
            updatedBalance = paymentResult.newBalance;
            console.log(`✅ [BookingController] Wallet deducted. New balance: ${updatedBalance}`);
        }

        // 3. Create Booking
        const bookingData = {
            userId,
            placeId,
            placeName: placeName || 'Unknown Place',
            checkIn: new Date(checkIn || Date.now()),
            checkOut: checkOut ? new Date(checkOut) : new Date(new Date(checkIn || Date.now()).getTime() + 2 * 60 * 60 * 1000), // Default 2 hours if missing
            bookingTime,
            totalPrice,
            currency: currency || 'EGP',
            status: status || 'active',
            placeType: placeType || 'hotel',
            paymentMethod: paymentMethod || 'VISA',
            source: source || 'manual',
            interestTags: interestTags || []
        };

        const newBooking = new Booking(bookingData);
        await newBooking.save();
        console.log("✅ [BookingController] Booking saved successfully:", newBooking._id);

        // 4. Notifications & Emails
        _handlePostBookingActions(newBooking); // Fire and forget with internal handling

        res.status(201).json({ 
            success: true, 
            message: "Trip booked successfully! Enjoy your experience.",
            notificationStatus: "Attempted (Check server logs for FCM status)",
            data: newBooking,
            newBalance: updatedBalance
        });
    } catch (error) {
        console.error("❌ [BookingController] Create Booking Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error: " + error.message });
    }
};

/**
 * Helper for post-booking side effects
 */
async function _handlePostBookingActions(booking) {
    // Send Push Notification
    try {
        await sendPushNotification(
            booking.userId,
            "Booking Confirmed! 🎉",
            `Your reservation at ${booking.placeName} is all set.`,
            booking.placeName
        );
    } catch (e) { console.warn("Push notification failed:", e.message); }

    // Send Email
    try {
        const user = await User.findOne({ uid: booking.userId });
        if (user && user.email) {
            await sendBookingEmail(user.email, {
                hotelName: booking.placeName,
                checkIn: booking.checkIn,
                checkOut: booking.checkOut,
                status: booking.status,
                totalPrice: booking.totalPrice,
                currency: booking.currency
            });
        }
    } catch (e) { console.warn("Email failed:", e.message); }

    // Price Tracking (for hotels)
    if (booking.placeType === 'hotel') {
        try {
            await PriceHistory.create({
                hotelId: booking.placeId,
                price: booking.totalPrice / 4,
                cityId: '-3712125'
            });
        } catch (e) { console.warn("Price history log failed"); }
    }
}

exports.getUserBookings = async (req, res) => {
    try {
        const { userId } = req.params;
        const allBookings = await Booking.find({ userId });
        const now = new Date();
        
        allBookings.sort((a, b) => {
            const aFuture = a.checkIn > now;
            const bFuture = b.checkIn > now;
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            return aFuture ? (a.checkIn - b.checkIn) : (b.checkIn - a.checkIn);
        });
        
        res.status(200).json({ success: true, data: allBookings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.getNextTrip = async (req, res) => {
    try {
        const { userId } = req.params;
        const now = new Date();
        const nextTrip = await Booking.findOne({
            userId,
            status: { $in: ['confirmed', 'active', 'reserved'] },
            checkIn: { $gte: now }
        }).sort({ checkIn: 1 });
        res.status(200).json({ success: true, data: nextTrip });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.cancelBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
        if (booking.status === 'cancelled') return res.status(400).json({ success: false, message: "Already cancelled" });

        booking.status = 'cancelled';
        await booking.save();

        // Optional: Refund logic if it was not PayOnArrival
        if (booking.paymentMethod !== 'PayOnArrival') {
             const { processWalletRefund } = require('../services/walletService');
             await processWalletRefund(booking.userId, booking.totalPrice, booking._id);
        }

        res.status(200).json({ success: true, data: booking });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
