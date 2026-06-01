const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        uptime: process.uptime()
    });
});

// ── Middlewares ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🔠 Global UTF-8 Encoding for Emoji & Arabic support
app.use((req, res, next) => {
    res.set('Content-Type', 'application/json; charset=utf-8');
    next();
});

// ── Controllers & Routes Imports ───────────────────────────────────────────
const paymentController = require('./controllers/paymentController');
const aiRoutes = require('./routes/api/aiRoutes');
const hotelRoutes = require('./routes/api/hotels');
const userRoutes = require('./routes/userRoutes'); 
const placeRoutes = require('./routes/placeRoutes');
const entertainmentRoutes = require('./routes/entertainmentRoutes');
const { currencyMiddleware } = require('./middleware/currencyMiddleware');
const initCron = require('./services/cronService'); 

app.use(currencyMiddleware);

// ── Route Definitions ──────────────────────────────────────────────────────
app.use('/api/places', placeRoutes);
app.use('/api/entertainment', entertainmentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', require('./routes/api/wallet'));
app.use('/api/bookings', require('./routes/api/bookings'));
app.use('/api/v2/trips', require('./routes/api/trips'));
app.use('/api/ratings', require('./routes/api/ratings'));
app.use('/api/notifications', require('./routes/api/notifications'));
app.use('/api/chat', require('./routes/api/chat'));
app.use('/api/user-places', require('./routes/userPlaceRoutes'));
app.use('/api/comments',    require('./routes/commentRoutes'));
app.use('/api/transport',   require('./routes/transportRoutes'));

// 🗓️ AI Smart Day Planner Routes
const smartPlannerController = require('./controllers/smartPlannerController');
app.post('/api/trips/smart-plan', smartPlannerController.generateSmartPlan);
app.get('/api/trips/smart-plans/:userId', smartPlannerController.getUserPlans);
app.delete('/api/trips/smart-plans/:planId', smartPlannerController.deletePlan);

// ── Feature 4: Trip Quality Analysis ──────────────────────────────────
const tripAnalysisController = require('./controllers/tripAnalysisController');
app.get('/api/trips/analysis/:userId', tripAnalysisController.getTripAnalysis);
app.get('/api/trips/comparison/:userId', tripAnalysisController.getPlaceComparison);

app.post('/api/payment/initiate', paymentController.initiatePayment);

// ── 🔧 DEBUG: Route Inspector (remove before production) ───────────────────
// Visit GET http://192.168.1.69:5000/debug/routes to see ALL active routes
app.get('/debug/routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            // Direct routes on app
            routes.push({
                path: middleware.route.path,
                methods: Object.keys(middleware.route.methods).join(', ').toUpperCase()
            });
        } else if (middleware.name === 'router' && middleware.handle.stack) {
            // Routes inside sub-routers (express.Router)
            middleware.handle.stack.forEach((handler) => {
                if (handler.route) {
                    const basePath = middleware.regexp.source
                        .replace('\\/?(?=\\/|$)', '')
                        .replace(/\\\//g, '/')
                        .replace('^', '')
                        .replace('?(?:/(?=$))?$', '');
                    routes.push({
                        path: basePath + handler.route.path,
                        methods: Object.keys(handler.route.methods).join(', ').toUpperCase()
                    });
                }
            });
        }
    });
    res.json({ totalRoutes: routes.length, routes });
});

// ── Global Error Handler (catches any unhandled errors) ────────────────────
app.use((err, req, res, next) => {
    console.error(`🛑 [GLOBAL ERROR] ${req.method} ${req.url} >> ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        message: 'An unexpected server error occurred.',
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// ── Database Connection & Lifecycle ──────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("🍃 Connected to MongoDB Successfully [Database: fas7ny]");
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
