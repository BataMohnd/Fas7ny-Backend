const Booking = require('../models/Booking');
const User = require('../models/User'); // Added to fetch user email
const { sendPushNotification } = require('../utils/notificationService');
const { sendBookingEmail } = require('../services/emailService');

/**
 * Creates a new booking and sends a confirmation notification.
 */
exports.createBooking = async (req, res) => {
    try {
        const bookingData = req.body;
        // Ensure status is active for new bookings
        bookingData.status = 'active';
        
        const newBooking = new Booking(bookingData);
        await newBooking.save();

        // Send Confirmation Notification
        try {
            await sendPushNotification(
                newBooking.userId,
                "Booking Confirmed! 🎉",
                `Your trip to ${newBooking.hotelName} is all set. Your status is now 'active'.`,
                newBooking.hotelName
            );
        } catch (fcmError) {
            console.warn("⚠️ Notification failed but booking saved:", fcmError.message);
        }

        // Send Email Confirmation
        try {
            const user = await User.findOne({ uid: newBooking.userId });
            if (user && user.email) {
                await sendBookingEmail(user.email, {
                    hotelName: newBooking.hotelName,
                    checkIn: newBooking.checkIn,
                    checkOut: newBooking.checkOut,
                    status: newBooking.status,
                    totalPrice: newBooking.totalPrice,
                    currency: newBooking.currency
                });
            }
        } catch (emailError) {
            console.warn("⚠️ Email sending failed but booking saved:", emailError.message);
        }

        res.status(201).json({ success: true, data: newBooking });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Fetches bookings for a user, optionally filtered by status.
 */
exports.getUserBookings = async (req, res) => {
    try {
        const { userId } = req.params;
        const allBookings = await Booking.find({ userId });
        
        const now = new Date();
        
        // Sort: Future (Upcoming) asc, then Past (History) desc
        allBookings.sort((a, b) => {
            const aFuture = a.checkIn > now;
            const bFuture = b.checkIn > now;
            
            if (aFuture && !bFuture) return -1;
            if (!aFuture && bFuture) return 1;
            
            if (aFuture) {
                return a.checkIn - b.checkIn; // Ascending for future
            } else {
                return b.checkIn - a.checkIn; // Descending for past
            }
        });
        
        res.status(200).json({ success: true, data: allBookings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Fetches the single next upcoming trip for a user.
 */
exports.getNextTrip = async (req, res) => {
    try {
        const { userId } = req.params;
        const now = new Date();

        const nextTrip = await Booking.findOne({
            userId,
            status: 'confirmed',
            checkIn: { $gte: now }
        }).sort({ checkIn: 1 });

        res.status(200).json({ success: true, data: nextTrip });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Cancels a booking by ID.
 */
exports.cancelBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId);
        
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ success: false, message: "Booking is already cancelled" });
        }

        const now = new Date();
        const checkInTime = new Date(booking.checkIn);
        const hoursUntilCheckIn = (checkInTime - now) / (1000 * 60 * 60);

        let refundAmount = booking.totalPrice;
        let penalty = 0;

        if (hoursUntilCheckIn < 12) {
            penalty = booking.totalPrice * 0.07; // 7% Penalty
            refundAmount = booking.totalPrice - penalty;
            console.log(`⚠️ 12-Hour Rule Applied: 7% Penalty (${penalty}) for booking ${bookingId}`);
        } else {
            console.log(`✅ Free Cancellation: Full refund for booking ${bookingId}`);
        }

        // 1. Mark as Cancelled
        booking.status = 'cancelled';
        await booking.save();

        // 2. Trigger Wallet Refund (Calling wallet logic via internal axios or direct require if possible)
        // For simplicity in this demo, we'll use a direct internal update logic or call the walletController if exported
        const walletController = require('./walletController');
        
        // Mocking a req/res for internal call or just using a service if we had one
        // Better: We'll perform the wallet update directly here to ensure transaction integrity
        const { refundWallet } = require('./walletController');
        
        // We'll wrap the logic in a fake req/res to reuse the controller method
        const fakeReq = {
            body: {
                userId: booking.userId,
                amount: refundAmount,
                penalty: penalty,
                bookingId: booking._id
            }
        };
        const fakeRes = {
            status: () => ({ json: (data) => data })
        };
        
        await refundWallet(fakeReq, fakeRes);

        res.status(200).json({ 
            success: true, 
            message: hoursUntilCheckIn < 12 ? "Cancelled with 7% penalty" : "Cancelled and refunded fully",
            data: booking,
            refund: refundAmount,
            penalty: penalty
        });

    } catch (error) {
        console.error("Cancellation Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};
