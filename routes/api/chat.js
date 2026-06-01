const express = require('express');
const router = express.Router();
const { sendMessage } = require('../../controllers/chatController');

router.post('/message', sendMessage);

module.exports = router;
