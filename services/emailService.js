const nodemailer = require('nodemailer');
require('dotenv').config();

// Create a reusable transporter using Gmail's SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'yourEmail@gmail.com',
        pass: process.env.EMAIL_PASS || 'yourAppPassword'
    }
});

/**
 * Sends a booking confirmation email
 * @param {string} toEmail 
 * @param {object} bookingData 
 */
const sendBookingEmail = async (toEmail, bookingData) => {
    try {
        if (!toEmail) return false;

        const mailOptions = {
            from: '"Fas7ny Support" <' + (process.env.EMAIL_USER || 'support@fas7ny.com') + '>',
            to: toEmail,
            subject: 'Fas7ny - Your Booking is Confirmed! 🎉',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #6366f1; text-align: center;">Booking Confirmed!</h2>
                    <p>Hello,</p>
                    <p>We are excited to confirm your booking for <strong>${bookingData.hotelName || 'your upcoming trip'}</strong>.</p>
                    
                    <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin-top: 0; color: #333;">Booking Details:</h4>
                        <ul style="list-style: none; padding: 0;">
                            <li style="margin-bottom: 8px;"><strong>Check-In:</strong> ${new Date(bookingData.checkIn).toLocaleDateString()}</li>
                            <li style="margin-bottom: 8px;"><strong>Check-Out:</strong> ${new Date(bookingData.checkOut).toLocaleDateString()}</li>
                            <li style="margin-bottom: 8px;"><strong>Status:</strong> ${bookingData.status}</li>
                            <li><strong>Total Paid:</strong> ${bookingData.totalPrice} ${bookingData.currency || 'EGP'}</li>
                        </ul>
                    </div>
                    
                    <p>If you have any questions, feel free to contact us.</p>
                    <p>Safe travels,<br><strong>The Fas7ny Team</strong></p>
                </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log("✉️ Booking Email sent successfully: " + info.messageId);
        return true;
    } catch (error) {
        console.error("🚨 Error sending booking email: ", error.message);
        return false;
    }
};

module.exports = {
    sendBookingEmail
};
