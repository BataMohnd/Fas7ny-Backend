const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.use(cors()); // Allow all origins for local/web testing
app.use(express.json());

// 🔠 Global UTF-8 Encoding for Emoji & Arabic support
app.use((req, res, next) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
});

const paymentController = require('./controllers/paymentController');
const aiRoutes = require('./routes/api/aiRoutes');
const hotelRoutes = require('./routes/api/hotels');
const userRoutes = require('./routes/userRoutes'); 

const { currencyMiddleware } = require('./middleware/currencyMiddleware');
const initCron = require('./services/cronService'); // Initialize background tasks


app.use(currencyMiddleware);

app.use('/api/ai', aiRoutes);

app.post('/api/payment/initiate', paymentController.initiatePayment);

app.use('/api/hotels', hotelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', require('./routes/api/wallet'));
app.use('/api/bookings', require('./routes/api/bookings'));
app.use('/api/v2/trips', require('./routes/api/trips'));



mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("🍃 Connected to MongoDB Successfully [Database: fas7ny]");
    
    // 🔥 Final Data Purge for Fresh Start (Places & Hotels)
    const Hotel = require('./models/HotelModel');
    const Place = require('./models/Place');
    Promise.all([
        Hotel.deleteMany({}),
        Place.deleteMany({})
    ]).then(() => {
        console.log("🔥 Database Purged (Places & Hotels) - Clean Slate for Multi-City Support.");
    }).catch(err => console.error("❌ Purge Error:", err.message));
    
    const placeRoutes = require('./routes/placeRoutes');
    app.use('/api/places', placeRoutes);
    
    const entertainmentRoutes = require('./routes/entertainmentRoutes');
    app.use('/api/entertainment', entertainmentRoutes);
    
    initCron(); // Start Auto-Archive Cron Job
  })
  .catch((err) => console.log("❌ MongoDB Connection Error: ", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🚀 Fas7ny AI Backend is LIVE on port ${PORT}
    📡 Primary IP: http://192.168.1.69:${PORT}
    📡 AI Search:    http://192.168.1.69:${PORT}/api/ai/smart-search
    🧠 AI Ranking:   http://192.168.1.69:${PORT}/api/ai/compare-rank
    🗺️ Trip Plans:  http://192.168.1.69:${PORT}/api/v2/trips/search
    💳 Payments:    http://192.168.1.69:${PORT}/api/payment/initiate
    
    📱 Samsung A305F can now connect to this local server! 🇪🇬✨
    `);
});