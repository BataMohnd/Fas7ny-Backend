const axios = require('axios');

function smartFallback(message) {
  const msg = message.toLowerCase();
  const isArabic = /[\u0600-\u06FF]/.test(message);

  if (msg.includes('hotel') || msg.includes('فندق')) {
    return isArabic
      ? 'يمكنك البحث عن الفنادق من الصفحة الرئيسية واختيار المدينة التي تريدها!'
      : 'You can search for hotels from the home screen. Just pick your city!';
  }
  if (msg.includes('trip') || msg.includes('رحلة') || msg.includes('plan')) {
    return isArabic
      ? 'استخدم مخطط الرحلات من القائمة الرئيسية لتخطيط رحلتك خطوة بخطوة!'
      : 'Use the Trip Planner from the main menu to plan your trip step by step!';
  }
  if (msg.includes('luxor') || msg.includes('الأقصر')) {
    return isArabic
      ? 'الأقصر وجهة رائعة! تفضل بزيارة معبد الكرنك ووادي الملوك. ميزانية مقترحة: 2500 جنيه.'
      : 'Luxor is amazing! Visit Karnak Temple and Valley of the Kings. Estimated budget: 2500 EGP.';
  }
  if (msg.includes('cairo') || msg.includes('القاهرة')) {
    return isArabic
      ? 'القاهرة مليانة حاجات تتعملها! الأهرامات والمتحف المصري من أبرز المعالم. ميزانية مقترحة: 3000 جنيه.'
      : 'Cairo has so much to offer! The Pyramids and Egyptian Museum are must-sees. Budget: 3000 EGP.';
  }
  if (msg.includes('hurghada') || msg.includes('الغردقة')) {
    return isArabic
      ? 'الغردقة وجهة مثالية للغوص والاسترخاء على الشاطئ. ميزانية مقترحة: 4500 جنيه.'
      : 'Hurghada is perfect for diving and beach relaxation. Budget: 4500 EGP.';
  }
  if (msg.includes('aswan') || msg.includes('أسوان')) {
    return isArabic
      ? 'أسوان جميلة جداً! زيارة معبد فيلة والقرية النوبية تجربة لا تُنسى. ميزانية: 2000 جنيه.'
      : 'Aswan is beautiful! Philae Temple and the Nubian Village are unforgettable. Budget: 2000 EGP.';
  }
  if (msg.includes('wallet') || msg.includes('محفظة') || msg.includes('pay')) {
    return isArabic
      ? 'يمكنك إدارة محفظتك من صفحة الملف الشخصي وإضافة رصيد في أي وقت!'
      : 'You can manage your wallet from the Profile page and top up anytime!';
  }

  return isArabic
    ? 'عذراً، أنا فاس7ني مساعدك السياحي! يمكنني مساعدتك في البحث عن فنادق وتخطيط رحلات في مصر.'
    : "Sorry, I'm Fas7ny your travel assistant! I can help you find hotels and plan trips in Egypt.";
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.sendMessage = async (req, res) => {
    try {
        const { userId, message, history = [] } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, message: "Message is required." });
        }

        const systemPersona = "You are Fas7ny, an Egyptian travel assistant. You help users plan trips, find hotels, and discover places in Egypt. Reply in the same language the user writes in (Arabic or English). Be friendly and concise.";

        // Construct contents array for multi-turn Gemini v1beta chat
        const contents = [
            { role: 'user', parts: [{ text: `SYSTEM: ${systemPersona}` }] },
            { role: 'model', parts: [{ text: 'understood' }] }
        ];

        // Add history
        history.forEach(m => {
            if (m.role && m.text) {
                contents.push({
                    role: m.role === 'user' ? 'user' : 'model',
                    parts: [{ text: m.text }]
                });
            }
        });

        // Add the new user message
        contents.push({ role: 'user', parts: [{ text: message }] });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        let lastError = null;
        let maxRetries = 3;
        let retryDelay = [1000, 2000, 4000];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[Chat Controller] Retrying due to 503... (Attempt ${attempt}/${maxRetries})`);
                    await sleep(retryDelay[attempt - 1]);
                }

                const response = await axios.post(url, { contents }, { timeout: 30000 });
                const reply = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
                
                if (!reply) {
                    throw new Error("Empty response from AI");
                }

                return res.status(200).json({ success: true, reply: reply.trim() });
            } catch (error) {
                lastError = error;
                const status = error.response?.status;
                
                // Only retry on 503 UNAVAILABLE
                if (status === 503 && attempt < maxRetries) {
                    continue;
                }

                // If not 503 or max retries reached, break out and use fallback
                break;
            }
        }

        console.warn(`[Chat Controller] AI_FALLBACK_USED. Error: ${lastError?.message}`);
        
        return res.status(200).json({ 
            success: true, 
            reply: smartFallback(message)
        });

    } catch (error) {
        console.error("[Chat Controller] Server Error:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
