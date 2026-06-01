const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Transaction = require('../models/TransactionModel');

dotenv.config({ path: '../.env' });

async function migrateStringAmounts() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fas7ny', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Connected.');

        // Find transactions where 'amount' is stored as a string
        const stringAmountTx = await Transaction.find({ amount: { $type: "string" } });
        console.log(`🔍 Found ${stringAmountTx.length} transactions with string amounts.`);

        if (stringAmountTx.length === 0) {
             console.log('✅ No migration needed. All amounts are numbers.');
             process.exit(0);
        }

        let updatedCount = 0;
        for (const tx of stringAmountTx) {
            const numericAmount = parseFloat(tx.amount);
            
            if (!isNaN(numericAmount)) {
                await Transaction.updateOne(
                    { _id: tx._id },
                    { $set: { amount: numericAmount } }
                );
                updatedCount++;
            } else {
                console.warn(`⚠️ Warning: Transaction ${tx._id} has an invalid amount string: "${tx.amount}". Skipping.`);
            }
        }

        console.log(`🎉 Migration Complete! Successfully converted ${updatedCount} amounts to numbers.`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration Error:', error);
        process.exit(1);
    }
}

migrateStringAmounts();
