const cron = require('node-cron');
const Booking = require('../models/Booking');
const { sendPushNotification } = require('../utils/notificationService');


const initCron = () => {
    // 0 * * * * = Every Hour
    cron.schedule('0 * * * *', async () => {
        console.log("🕒 Running Auto-Archive Job...");

        try {
            const now = new Date();

            // 1. Find Confirmed Bookings that have passed checkOut
            const completedBookings = await Booking.find({
                status: 'confirmed',
                checkOut: { $lt: now }
            });

            if (completedBookings.length > 0) {
                console.log(`📦 Archiving ${completedBookings.length} completed trips...`);

                for (const booking of completedBookings) {
                    // Update status
                    booking.status = 'completed';
                    await booking.save();

                    // Notify the user
                    await sendPushNotification(
                        booking.userId,
                        "Trip Completed! 🏨",
                        `We hope you enjoyed your stay at ${booking.hotelName}. Rate your experience or book your next adventure!`,
                        booking.hotelName // Personalize body with destination/hotel
                    );
                }
            }
        } catch (error) {
            console.error("❌ Cron Job Error: ", error.message);
        }
    });

    console.log("🚀 Cron Service Initialized (Hourly Check Enabled)");
};

module.exports = initCron;
