const express = require('express');
const router = express.Router();
const walletController = require('../../controllers/walletController');

// NOTE: currencyMiddleware is already applied globally in server.js.
// Applying it again here caused double-execution and silent 404s — removed.

router.post('/topup',             walletController.topUp);
router.post('/withdraw',          walletController.withdraw);
router.post('/payment',           walletController.payment);
router.get('/balance/:userId',    walletController.getBalance);
router.get('/history/:userId',    walletController.getHistory);
router.post('/refund',            walletController.refundWallet);

module.exports = router;
