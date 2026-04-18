const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/:id', userController.getUserProfile); 
router.get('/interests/:id', userController.getInterests); 
router.patch('/update-wallet', userController.updateBalance); 
router.patch('/update-profile-picture', userController.updateProfileImageUrl);
router.patch('/update-interests', userController.updateInterests);
router.post('/sync', userController.syncUser);
router.post('/forgot-password', userController.forgotPassword);
router.post('/reset-password', userController.resetPassword);

module.exports = router;