const Transaction = require('../models/TransactionModel');
const User = require('../models/User'); // Added User model
const admin = require('../firebaseConfig');
const crypto = require('crypto');

// Helper to push to firebase Realtime Database safely
const syncToFirebase = async (transactionData, currentBalance) => {
    try {
        if (admin.apps.length > 0) {
            const db = admin.database();
            // Sync Transaction
            const txRef = db.ref(`users/${transactionData.userId}/transactions/${transactionData.transactionId}`);
            await txRef.set(transactionData);
            
            // Sync Total Balance for UI speed
            const balanceRef = db.ref(`users/${transactionData.userId}/wallet/balance`);
            await balanceRef.set(currentBalance);
            
            console.log(`✅ Synced transaction and balance to Firebase`);
        }
    } catch (err) {
        console.log(`⚠️ Firebase Sync failed: ${err.message}`);
    }
};

exports.topUp = async (req, res) => {
    try {
        const { userId, amount } = req.body;
        let currency = req.userCurrency || 'EGP';

        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId,
            amount: parseFloat(amount),
            currency: currency,
            status: 'success',
            type: 'top_up',
            date: new Date(),
            description: `Deposited ${parseFloat(amount).toFixed(0)} EGP to Fas7ny Wallet`
        };

        // 1. Save Transaction to Mongo
        const newTx = new Transaction(transactionData);
        await newTx.save();

        // 2. Update User Balance in Mongo
        const user = await User.findOneAndUpdate(
            { uid: userId },
            { $inc: { walletBalance: transactionData.amount } },
            { new: true }
        );

        // 3. Sync to Firebase
        await syncToFirebase(transactionData, user.walletBalance);

        return res.status(200).json({
            success: true,
            balance: user.walletBalance,
            data: transactionData
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.payment = async (req, res) => {
    try {
        const { userId, amount } = req.body;
        let currency = req.userCurrency || 'EGP';

        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId,
            amount: parseFloat(amount),
            currency: currency,
            status: 'success',
            type: 'payment',
            date: new Date(),
            description: `Payment for booking trip`
        };

        // 1. Save Transaction to Mongo
        const newTx = new Transaction(transactionData);
        await newTx.save();

        // 2. Update User Balance in Mongo
        const user = await User.findOneAndUpdate(
            { uid: userId },
            { $inc: { walletBalance: -transactionData.amount } },
            { new: true }
        );

        // 3. Sync to Firebase
        await syncToFirebase(transactionData, user.walletBalance);

        return res.status(200).json({
            success: true,
            balance: user.walletBalance,
            data: transactionData
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.withdraw = async (req, res) => {
    try {
        const { userId, amount } = req.body;
        let currency = req.userCurrency || 'EGP';

        // 1. Verify user and balance
        const user = await User.findOne({ uid: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        if (user.walletBalance < parseFloat(amount)) {
            return res.status(400).json({ success: false, message: "Insufficient balance" });
        }

        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId,
            amount: parseFloat(amount),
            currency: currency,
            status: 'success',
            type: 'withdrawal',
            date: new Date(),
            description: `Withdrawn ${parseFloat(amount).toFixed(0)} EGP from wallet`
        };

        // 2. Save Transaction to Mongo
        const newTx = new Transaction(transactionData);
        await newTx.save();

        // 3. Update User Balance in Mongo (Atomically)
        const updatedUser = await User.findOneAndUpdate(
            { uid: userId },
            { $inc: { walletBalance: -transactionData.amount } },
            { new: true }
        );

        // 4. Sync to Firebase
        await syncToFirebase(transactionData, updatedUser.walletBalance);

        return res.status(200).json({
            success: true,
            balance: updatedUser.walletBalance,
            data: transactionData,
            message: "Withdrawal successful"
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const transactions = await Transaction.find({ userId }).sort({ date: -1 });
        res.status(200).json({ success: true, data: transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.refundWallet = async (req, res) => {
    try {
        const { userId, amount, penalty, bookingId } = req.body;
        const finalRefund = parseFloat(amount);
        const penaltyAmount = parseFloat(penalty || 0);

        const transactionData = {
            transactionId: crypto.randomUUID(),
            userId: userId,
            amount: finalRefund,
            currency: 'EGP',
            status: 'success',
            type: 'top_up', // Refund is essentially a credit
            date: new Date(),
            description: penaltyAmount > 0 
                ? `Refund (after ${penaltyAmount.toFixed(0)} penalty) for booking ${bookingId}` 
                : `Full Refund for booking ${bookingId}`
        };

        // 1. Save Transaction
        const newTx = new Transaction(transactionData);
        await newTx.save();

        // 2. Update Balance
        const user = await User.findOneAndUpdate(
            { uid: userId },
            { $inc: { walletBalance: finalRefund } },
            { new: true }
        );

        // 3. Sync to Firebase
        await syncToFirebase(transactionData, user.walletBalance);

        return res.status(200).json({ success: true, balance: user.walletBalance });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
