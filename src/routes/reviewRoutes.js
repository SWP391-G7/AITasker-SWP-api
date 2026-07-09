const express = require('express');
const router = express.Router();
const { createReview, getReviewByTargetId } = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

// Route to submit a review (Requires auth)
router.post('/', protect, createReview);

// Route to get reviews by target user ID (Public)
router.get('/target/:targetId', getReviewByTargetId);

module.exports = router;
