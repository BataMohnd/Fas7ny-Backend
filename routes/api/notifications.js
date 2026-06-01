const express = require('express');
const router = express.Router();
const notificationController = require('../../controllers/notificationController');

router.post('/create', notificationController.createNotification);
router.get('/user/:userId', notificationController.getNotifications);
router.put('/:id/read', notificationController.markAsRead);
router.put('/user/:userId/read-all', notificationController.markAllRead);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
