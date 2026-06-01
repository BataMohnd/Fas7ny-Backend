const Notification = require('../models/Notification');

// Get all notifications for a user
exports.getNotifications = async (req, res) => {
    try {
        const { userId } = req.params;
        const notifications = await Notification.find({ userId })
            .sort({ createdAt: -1 })
            .limit(50);
        
        res.status(200).json({
            success: true,
            data: notifications
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Mark a notification as read
exports.markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.findByIdAndUpdate(id, { isRead: true });
        res.status(200).json({ success: true, message: "Notification marked as read" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Mark all as read
exports.markAllRead = async (req, res) => {
    try {
        const { userId } = req.params;
        await Notification.updateMany({ userId, isRead: false }, { isRead: true });
        res.status(200).json({ success: true, message: "All notifications marked as read" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Delete notification
exports.deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        await Notification.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: "Notification deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Create a notification manually (e.g. from app actions)
exports.createNotification = async (req, res) => {
    try {
        const { userId, title, body, type, data } = req.body;
        const notification = await Notification.create({
            userId, title, body, type, data
        });
        res.status(201).json({ success: true, data: notification });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
