require('dotenv').config();
const axios = require('axios');

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    // الـ Endpoint دي بتجيب كل الموديلات المتاحة للـ Key دي
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;

    try {
        const response = await axios.get(url);
        console.log("✅ الموديلات المتاحة عندك هي:");
        response.data.models.forEach(model => {
            console.log(`- ${model.name} (Supported methods: ${model.supportedGenerationMethods})`);
        });
    } catch (err) {
        console.error("❌ إيرور في جلب الموديلات:", err.response ? err.response.data : err.message);
    }
}

listModels();