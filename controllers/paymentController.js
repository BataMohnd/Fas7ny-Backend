const axios = require('axios');

exports.initiatePayment = async (req, res) => {
    try {
        const { amount, user } = req.body; // المبلغ بالجنيه وبيانات اليوزر
        const amountCents = amount * 100; // تحويل لقرش لأن Paymob بيتعامل بالقروش

        // 1. Authentication Request
        const authRes = await axios.post('https://egypt.paymob.com/api/auth/tokens', {
            api_key: process.env.PAYMOB_API_KEY
        });
        const token = authRes.data.token;

        // 2. Order Registration Request
        const orderRes = await axios.post('https://egypt.paymob.com/api/ecommerce/orders', {
            auth_token: token,
            delivery_needed: "false",
            amount_cents: amountCents,
            currency: "EGP",
            items: []
        });
        const orderId = orderRes.data.id;

        // 3. Payment Key Generation
        const keyRes = await axios.post('https://egypt.paymob.com/api/acceptance/payment_keys', {
            auth_token: token,
            amount_cents: amountCents,
            expiration: 3600,
            order_id: orderId,
            billing_data: {
                apartment: "NA", email: user.email, floor: "NA",
                first_name: user.name.split(' ')[0] || "User",
                last_name: user.name.split(' ')[1] || "Name",
                street: "NA", building: "NA", phone_number: "+20123456789",
                shipping_method: "NA", postal_code: "NA", city: "Cairo", country: "EG", state: "Cairo"
            },
            currency: "EGP",
            integration_id: process.env.PAYMOB_INTEGRATION_ID
        });

        // 4. ابعت لينك الـ Iframe للفلاتر
        const paymentToken = keyRes.data.token;
        const iframeUrl = `https://egypt.paymob.com/api/acceptance/iframes/${process.env.PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;
        
        res.status(200).json({ success: true, iframeUrl });

    } catch (error) {
        console.error("Paymob Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: "فشل إنشاء عملية الدفع" });
    }
};