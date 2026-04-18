const admin = require('../firebaseConfig');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });

/**
 * Sends a push notification to a specific user.
 * Includes Gemini for personalized travel tips if destination is provided.
 */
exports.sendPushNotification = async (userId, title, body, destination = null) => {
    try {
        let finalBody = body;

        // 1. Personalized Gemini Touch (Optional)
        if (destination) {
            try {
                const prompt = `Generate a short, enthusiastic travel notification body (max 20 words) for a user going to ${destination}. Mention a local vibe or a quick tip. Keep it friendly.`;
                const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
                const response = await result.response;
                finalBody = response.text().trim() || body;
            } catch (geminiError) {
                console.warn("⚠️ Gemini failed, using default body: ", geminiError.message);
            }
        }

        const message = {
            notification: {
                title: title,
                body: finalBody,
            },
            data: {
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                userId: userId,
                timestamp: new Date().toISOString()
            },
            topic: `user_${userId}` // We use topics for simplicity if token is not saved
        };

        // 2. Send via Firebase Admin
        const response = await admin.messaging().send(message);
        console.log(`✅ Push Notification sent to user_${userId}: `, response);
        return response;
    } catch (error) {
        console.error("❌ FCM Error: ", error.message);
        throw error;
    }
};
