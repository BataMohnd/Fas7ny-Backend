const admin = require('../firebaseConfig');
const { callGemini } = require('./geminiClient');
const Notification = require('../models/Notification');

/**
 * Sends a push notification to a specific user and saves it to the database history.
 * Includes Gemini for personalized travel tips if destination is provided.
 * 🟢 Demo Safe: Does not throw errors if Firebase is misconfigured.
 */
exports.sendPushNotification = async (userId, title, body, destination = null, type = 'system', extraData = {}) => {
    try {
        let personalizedBody = body;

        // 1. Personalized Gemini Touch (Optional)
        if (destination) {
            try {
                const prompt = `Rewrite this notification to be more engaging and personalized for a user interested in travel to ${destination}. Original body: "${body}". Max 15 words. Arabic language.`;
                console.log("📡 [Fas7ny AI] Calling Direct REST API for Personalized Notification");
                const aiResult = await callGemini(prompt);
                
                if (aiResult.ok) {
                    personalizedBody = aiResult.text.trim();
                } else {
                    console.log(`📡 [Notifications] Using original body due to model return error.`);
                }
            } catch (aiErr) {
                console.log("📡 [Notifications] AI personalization skipped:", aiErr.message);
            }
        }

        // 2. Persist to Database Notification History (Ensures it appears in the app regardless of FCM)
        try {
            await Notification.create({
                userId,
                title,
                body: personalizedBody,
                type,
                data: extraData
            });
            console.log(`💾 Notification saved to DB for user_${userId}`);
        } catch (dbErr) {
            console.error("❌ Failed to save notification to DB:", dbErr.message);
        }

        // 3. Check if admin is initialized properly (demo safety check)
        if (!admin || !admin.app || admin.app.length === 0) {
            console.warn("⚠️ [Fas7ny FCM] Firebase Admin not initialized. Skipping push notification.");
            return { success: false, reason: "Firebase Admin not initialized" };
        }

        const message = {
            notification: {
                title: title,
                body: personalizedBody,
            },
            data: {
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                userId: userId,
                type: type,
                timestamp: new Date().toISOString()
            },
            topic: `user_${userId}` 
        };

        // 4. Send via Firebase Admin
        try {
            const response = await admin.messaging().send(message);
            console.log(`✅ Push Notification sent to user_${userId}: `, response);
            return { success: true, response };
        } catch (fcmError) {
            console.warn("⚠️ [Fas7ny FCM] Push Notification failed (possibly missing credentials):", fcmError.message);
            return { success: false, reason: fcmError.message };
        }
    } catch (error) {
        console.error("❌ Notification Controller Error: ", error.message);
        return { success: false, reason: error.message };
    }
};
