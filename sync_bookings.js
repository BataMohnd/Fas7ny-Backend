const mongoose = require('mongoose');
const Booking = require('./models/Booking');
require('dotenv').config();

const syncBookings = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fas7ny');
        
        console.log('🚀 Syncing bookings: confirmed -> active...');
        const result = await Booking.updateMany(
            { status: 'confirmed' },
            { $set: { status: 'active' } }
        );
        
        console.log(`✅ Sync complete. Updated ${result.modifiedCount} bookings.`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Sync failed:', err.message);
        process.exit(1);
    }
};

syncBookings();
