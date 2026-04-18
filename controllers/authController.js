const User = require('../models/User');

// ميثود تحديث اسم المستخدم
exports.updateName = async (req, res) => {
    try {
        const { userId, newName } = req.body; // بنستلم الـ ID والاسم الجديد

        const updatedUser = await User.findOneAndUpdate(
            { uid: userId }, 
            { name: newName }, 
            { new: true } // عشان يرجع اليوزر بالبيانات الجديدة بعد التعديل
        );

        res.status(200).json({
            status: 'success',
            data: updatedUser
        });
    } catch (err) {
        res.status(400).json({ status: 'fail', message: err.message });
    }
};