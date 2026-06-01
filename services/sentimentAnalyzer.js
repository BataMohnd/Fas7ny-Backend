const { callGemini } = require('../utils/geminiClient');

/**
 * Generates a 1-sentence Arabic summary of hotel/place reviews.
 * @param {number} score - The review score.
 * @param {string} texts - A sample of review texts if available.
 * @returns {Promise<string>} - The Arabic summary.
 */
exports.generateSentimentSummary = async (score, texts = "No specific text available") => {
    try {
        const prompt = `Analyze these hotel reviews and provide a 1-sentence 'Executive Summary' highlighting pros and cons in Arabic. 
        Rating: ${score}/5. 
        Sample reviews: ${texts.substring(0, 500)}.
        Keep it professional, concise, and friendly. Output plain text Arabic only.`;

        console.log("📡 [Fas7ny AI] Triggering Sentiment Evaluation");
        const aiResult = await callGemini(prompt);
        if (aiResult.ok) {
            return aiResult.text.trim();
        } else {
            console.log(`📡 [Sentiment] Using local fallback due to: ${aiResult.error}`);
            return "تجربة سياحية فريدة تم تقييمها بعناية لتناسب تفضيلاتك.";
        }
    } catch (error) {
        console.error("❌ Sentiment Logic Error:", error.message);
        return "تجربة سياحية فريدة تم تقييمها بعناية لتناسب تفضيلاتك.";
    }
};
