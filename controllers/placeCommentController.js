const PlaceComment = require('../models/PlaceComment');
const admin = require('firebase-admin');

// ── GET /api/comments/:placeId ─────────────────────────────────────────────
exports.getComments = async (req, res) => {
  try {
    const comments = await PlaceComment
      .find({ placeId: req.params.placeId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.status(200).json({ success: true, data: comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/comments/:placeId ────────────────────────────────────────────
exports.addComment = async (req, res) => {
  try {
    const { userId, userName, userPhoto, message, rating } = req.body;

    if (!userId || !message?.trim()) {
      return res.status(400).json({ success: false, message: 'userId and message are required' });
    }

    const comment = new PlaceComment({
      placeId:   req.params.placeId,
      userId,
      userName:  userName || 'Anonymous',
      userPhoto: userPhoto || '',
      message:   message.trim(),
      rating:    rating || null,
    });

    await comment.save();
    console.log(`[Comment] ✅ New comment on ${req.params.placeId} by ${comment.userName}`);

    // ── Real-time: sync to Firestore (non-critical) ──────────────────────
    try {
      await admin.firestore()
        .collection('placeComments')
        .doc(comment._id.toString())
        .set({
          placeId:   comment.placeId,
          userId:    comment.userId,
          userName:  comment.userName,
          userPhoto: comment.userPhoto,
          message:   comment.message,
          rating:    comment.rating,
          likes:     0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
      console.warn('[Comment] Firestore sync failed (non-critical):', e.message);
    }

    res.status(201).json({ success: true, data: comment });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/comments/:commentId/like ────────────────────────────────────
exports.likeComment = async (req, res) => {
  try {
    const { userId } = req.body;
    const comment = await PlaceComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    const alreadyLiked = comment.likedBy.includes(userId);
    if (alreadyLiked) {
      comment.likedBy.pull(userId);
      comment.likes = Math.max(0, comment.likes - 1);
    } else {
      comment.likedBy.push(userId);
      comment.likes += 1;
    }
    await comment.save();

    // Sync like count to Firestore
    try {
      await admin.firestore()
        .collection('placeComments')
        .doc(req.params.commentId)
        .update({ likes: comment.likes });
    } catch (e) {
      console.warn('[Comment] Firestore like sync failed:', e.message);
    }

    res.status(200).json({ success: true, likes: comment.likes, liked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/comments/:commentId ───────────────────────────────────────
exports.deleteComment = async (req, res) => {
  try {
    const comment = await PlaceComment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    if (comment.userId !== req.body.userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this comment' });
    }

    await PlaceComment.findByIdAndDelete(req.params.commentId);

    // Delete from Firestore
    try {
      await admin.firestore()
        .collection('placeComments')
        .doc(req.params.commentId)
        .delete();
    } catch (e) {
      console.warn('[Comment] Firestore delete sync failed:', e.message);
    }

    res.status(200).json({ success: true, message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
