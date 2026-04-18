const express = require('express');
const router = express.Router();
const walletController = require('../../controllers/walletController');
const { currencyMiddleware } = require('../../middleware/currencyMiddleware');

router.use(currencyMiddleware);

router.post('/topup', walletController.topUp);
router.post('/withdraw', walletController.withdraw);
router.get('/history/:userId', walletController.getHistory);

module.exports = router;
