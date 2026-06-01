const crypto = require('crypto');
const Transaction = require('../models/TransactionModel');
const admin = require('../firebaseConfig');

// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE: Fail-Safe User Verification
// ─────────────────────────────────────────────────────────────────────────────
const verifyUserId = async (userId) => {
    console.log(`[Debug] Searching for user ID: ${userId} (Type: ${typeof userId})`);

    // Tier 1: Try Firebase Admin Auth
    try {
        const userRecord = await admin.auth().getUser(userId);
        console.log(`[DB Verification] Found User with ID: ${userRecord.uid} using field: Firebase Auth UID`);
        return { valid: true, source: 'firebase_auth' };
    } catch (firebaseErr) {
        console.warn(`[Auth Warning] Firebase Auth lookup failed: ${firebaseErr.message}`);
    }

    // Tier 2: Check if userId has any existing transaction
    const existingTx = await Transaction.findOne({ userId: userId.toString() });
    if (existingTx) {
        console.log(`[DB Verification] Found User with ID: ${userId} using field: transactions.userId`);
        return { valid: true, source: 'transaction_history' };
    }

    // Tier 3: Accept well-formed Firebase UIDs
    const looksLikeFirebaseUid = /^[a-zA-Z0-9]{20,}$/.test(userId);
    if (looksLikeFirebaseUid) {
        console.log(`[DB Verification] Accepting new user ID: ${userId} by format validation`);
        return { valid: true, source: 'format_validation' };
    }

    console.error(`[Auth Fail] userId '${userId}' failed all 3 verification tiers.`);
    return { valid: false, source: 'none' };
};

const getAggregatedBalance = async (userId) => {
    const balanceData = await Transaction.aggregate([
        { $match: { userId: userId.toString(), status: 'success' } },
        {
            $project: {
                amount: 1,
                multiplier: {
                    $cond: [{ $in: ['$type', ['top_up', 'refund']] }, 1, -1]
                }
            }
        },
        {
            $group: {
                _id: null,
                totalBalance: { $sum: { $multiply: ['$amount', '$multiplier'] } }
            }
        }
    ]);
    const balance = balanceData.length > 0 ? balanceData[0].totalBalance : 0;
    return balance;
};

const syncToFirebase = async (transactionData, currentBalance) => {
    try {
        if (admin.apps.length > 0) {
            const db = admin.database();
            await db.ref(`users/${transactionData.userId}/transactions/${transactionData.transactionId}`).set(transactionData);
            await db.ref(`users/${transactionData.userId}/wallet/balance`).set(currentBalance);
        }
    } catch (err) {
        console.warn(`⚠️ Firebase Sync failed: ${err.message}`);
    }
};

const processWalletPayment = async (userId, amount, bookingId = null) => {
    const verification = await verifyUserId(userId);
    if (!verification.valid) {
        return { success: false, message: "User not found for wallet payment." };
    }

    const liveBalance = await getAggregatedBalance(userId);
    if (liveBalance < amount) {
        return { success: false, message: `Insufficient wallet balance. You have ${liveBalance.toFixed(2)} EGP.` };
    }

    const transactionData = {
        transactionId: crypto.randomUUID(),
        userId: userId.toString(),
        amount,
        currency: 'EGP',
        status: 'success',
        type: 'payment',
        date: new Date(),
        description: bookingId ? `Payment for booking ${bookingId}` : 'Payment for booking trip'
    };

    await new Transaction(transactionData).save();
    const newBalance = await getAggregatedBalance(userId);
    await syncToFirebase(transactionData, newBalance);

    return { success: true, newBalance, data: transactionData };
};

const processWalletRefund = async (userId, amount, bookingId) => {
    const transactionData = {
        transactionId: crypto.randomUUID(),
        userId: userId.toString(),
        amount,
        currency: 'EGP',
        status: 'success',
        type: 'refund',
        date: new Date(),
        description: `Full Refund for booking ${bookingId}`
    };

    await new Transaction(transactionData).save();
    const newBalance = await getAggregatedBalance(userId);
    await syncToFirebase(transactionData, newBalance);

    return { success: true, newBalance, data: transactionData };
};

module.exports = {
    verifyUserId,
    getAggregatedBalance,
    syncToFirebase,
    processWalletPayment,
    processWalletRefund
};
