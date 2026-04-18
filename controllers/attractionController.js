const axios = require('axios');

exports.getAttractionAvailability = async (req, res) => {
    // هناخد الـ ID والتاريخ من الـ Request اللي جاي من الموبايل
    const { attractionId, date } = req.query; 

    const options = {
        method: 'GET',
        url: 'https://booking-com.p.rapidapi.com/v1/attractions/availability',
        params: {
            date: date || '2026-09-18', // التاريخ
            attraction_id: attractionId || 'PRFZkGSVnM5d', // الـ ID بتاع المكان
            locale: 'en-gb',
            currency: 'AED'
        },
        headers: {
            'x-rapidapi-key': '931526fb46msh984a7bdb7ab2e90p14f6b6jsn84db4c6f3237',
            'x-rapidapi-host': 'booking-com.p.rapidapi.com'
        }
    };

    try {
        const response = await axios.request(options);
        
        // هنا الداتا بترجع للـ Flutter
        res.status(200).json({
            success: true,
            data: response.data
        });
        
        console.log("✅ Attractions Data Fetched Successfully!");
    } catch (error) {
    // السطر ده هيخلينا نشوف الـ Error الحقيقي في صفحة المتصفح
    const errorDetail = error.response ? error.response.data : error.message;
    console.error("❌ Full Error Detail:", errorDetail);
    
    res.status(500).json({
        success: false,
        message: "Failed to fetch data from Booking.com API",
        actualError: errorDetail // ضيف السطر ده عشان تشوف الـ Error في المتصفح
    });
}}