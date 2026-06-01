const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/placeCommentController');

router.get('/:placeId',         ctrl.getComments);   // Fetch comments for a place
router.post('/:placeId',        ctrl.addComment);    // Post a new comment
router.post('/:commentId/like', ctrl.likeComment);   // Toggle like on a comment
router.delete('/:commentId',    ctrl.deleteComment); // Delete own comment

module.exports = router;
