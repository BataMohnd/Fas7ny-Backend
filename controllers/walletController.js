const mongoose = require('mongoose');
const Transaction = require('../models/TransactionModel');
const crypto = require('crypto');
const { verifyUserId, getAggregatedBalance, syncToFirebase, processWalletPayment, processWalletRefund } = require('../services/walletService');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/topup
// ─────────────────────────────────────────────────────────────────────────────
exports.topUp = async (req, res) => {
    try {
        const userId = req.body.userId || req.headers.userid || req.headers['user-id'];
        const amount = parseFloat(req.body.amount);
        const currency = req.userCurrency || 'EGP';

        console.log(`[Wallet] TopUp requested — user: ${userId}, amount: ${amount}`);

        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: Missing userId.' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        // Verify user via 3-tier fail-safe check
        const verification = await verifyUserId(userId);
        if (!verification.valid) {
            return res.status(404).json({ success: false, message: `User not found. Provided ID: ${userId}` });
        }

        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId.toString(),
            amount,
            currency,
            status: 'success',
            type: 'top_up',
            date: new Date(),
            description: `Deposited ${amount.toFixed(0)} EGP to Fas7ny Wallet`
        };

        await new Transaction(transactionData).save();

        const newBalance = await getAggregatedBalance(userId);

        // Non-blocking Firebase sync
        syncToFirebase(transactionData, newBalance);

        return res.status(200).json({ success: true, balance: newBalance, data: transactionData });
    } catch (error) {
        console.error('[topUp Error]', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/payment  (booking deduction — no user lookup needed)
// ─────────────────────────────────────────────────────────────────────────────
exports.payment = async (req, res) => {
    try {
        const userId = req.body.userId || req.headers.userid || req.headers['user-id'];
        const amount = parseFloat(req.body.amount);

        console.log(`[Wallet] Payment requested — user: ${userId}, amount: ${amount}`);

        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: Missing userId.' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        const result = await processWalletPayment(userId, amount);
        
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(200).json({ success: true, balance: result.newBalance, data: result.data });
    } catch (error) {
        console.error('[payment Error]', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/withdraw  (manual withdrawal by user)
// ─────────────────────────────────────────────────────────────────────────────
exports.withdraw = async (req, res) => {
    try {
        const userId = req.body.userId || req.headers.userid || req.headers['user-id'];
        const amount = parseFloat(req.body.amount);
        const currency = req.userCurrency || 'EGP';

        console.log(`[Wallet] Withdraw requested — user: ${userId}, amount: ${amount}`);

        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: Missing userId.' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        // STEP 1: Verify user via 3-tier fail-safe check
        const verification = await verifyUserId(userId);
        if (!verification.valid) {
            return res.status(404).json({
                success: false,
                message: `User not found. Provided ID: ${userId}`
            });
        }

        // STEP 2: Fresh aggregation balance check — server-side validation
        const liveBalance = await getAggregatedBalance(userId);
        console.log(`[Withdraw Validation] User: ${userId} | Live Balance: ${liveBalance} EGP | Requested: ${amount} EGP`);

        if (liveBalance < amount) {
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. Available: ${liveBalance.toFixed(2)} EGP`
            });
        }

        // STEP 3: Record the transaction
        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId.toString(),
            amount,
            currency,
            status: 'success',
            type: 'withdrawal',
            date: new Date(),
            description: `Withdrawn ${amount.toFixed(0)} EGP from wallet`
        };

        await new Transaction(transactionData).save();

        const newBalance = await getAggregatedBalance(userId);

        // STEP 4: Non-blocking Firebase sync
        syncToFirebase(transactionData, newBalance);

        return res.status(200).json({
            success: true,
            balance: newBalance,
            data: transactionData,
            message: 'Withdrawal successful'
        });
    } catch (error) {
        console.error('[withdraw Error]', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/balance/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.getBalance = async (req, res) => {
    try {
        const userId = req.params.userId || req.query.userId || req.headers.userid;
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: Missing userId.' });

        console.log(`[Debug] Searching for user ID: ${userId} (Type: ${typeof userId})`);

        const liveBalance = await getAggregatedBalance(userId);

        return res.status(200).json({ success: true, balance: liveBalance });
    } catch (error) {
        console.error('[getBalance Error]', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wallet/history/:userId
// ─────────────────────────────────────────────────────────────────────────────
exports.getHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const transactions = await Transaction.find({ userId: userId.toString() }).sort({ date: -1 });
        res.status(200).json({ success: true, data: transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wallet/refund
// ─────────────────────────────────────────────────────────────────────────────
exports.refundWallet = async (req, res) => {
    try {
        const { userId, amount, penalty, bookingId } = req.body;
        const finalRefund = parseFloat(amount);
        const penaltyAmount = parseFloat(penalty || 0);

        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized: Missing userId.' });

        const result = await processWalletRefund(userId, finalRefund, bookingId || 'Unknown');
        
        if (!result.success) {
            return res.status(400).json(result);
        }

        return res.status(200).json({ success: true, balance: result.newBalance });
    } catch (error) {
        console.error('[refundWallet Error]', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};
