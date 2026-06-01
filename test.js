require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function test() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Say hello!");
    console.log("الـ AI رد وقال:", result.response.text());
}
test().catch(err => console.error("إيرور في الاختبار:", err.message));