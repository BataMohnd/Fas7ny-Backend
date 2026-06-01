const axios = require('axios');

const ALLOWED_MODELS = ['gemini-2.5-flash'];
const DEFAULT_MODEL = 'gemini-2.5-flash';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function callGemini(promptText) {
    const envModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const activeModel = ALLOWED_MODELS.includes(envModel) ? envModel : DEFAULT_MODEL;
    
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;
    
    let lastError = null;
    const maxRetries = 2;
    const retryDelay = [500, 1000];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`📡 [Gemini Client] Retrying due to 503... (Attempt ${attempt}/${maxRetries})`);
                await sleep(retryDelay[attempt - 1]);
            } else {
                console.log(`📡 [Gemini Client] Calling direct REST v1beta [Model: ${activeModel}]...`);
            }

            const response = await axios.post(
                url,
                { contents: [{ parts: [{ text: promptText }] }] },
                { timeout: 20000 }
            );

            const aiOutput = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!aiOutput) {
                console.warn('⚠️ [Gemini Client] Empty response from API. AI_FALLBACK_USED');
                return { ok: false, source: 'fallback', error: 'Empty output from model', text: null };
            }

            console.log('✅ [Gemini Client] AI_SUCCESS');
            return { ok: true, source: 'gemini', text: aiOutput.trim() };

        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            
            if (status === 503 && attempt < maxRetries) {
                continue;
            }

            let errorMsg = error.message;
            if (error.response) {
                const data = JSON.stringify(error.response.data);
                errorMsg = `[Status ${status}] Data: ${data}`;
                
                if (status === 403) {
                    console.warn('🚫 [Gemini Client] Permission Denied (403). Check GEMINI_API_KEY in .env');
                } else if (status === 404) {
                    console.warn(`❌ [Gemini Client] Model Not Found (404). Model: ${activeModel}`);
                }
            }

            console.warn(`⚠️ [Gemini Client] AI_FALLBACK_USED. Error: ${errorMsg}`);
            return { ok: false, source: 'fallback', error: errorMsg, text: null };
        }
    }
}

module.exports = { callGemini };