const express = require('express');
const router = express.Router();
const { createReview, getReviewByTargetId, checkCanReview } = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

// Route to check if current user can review a service
router.get('/can-review/:serviceId', protect, checkCanReview);

// Route to submit a review (Requires auth)
router.post('/', protect, createReview);

// Route to get reviews by service ID (Public)
router.get('/target/:targetId', getReviewByTargetId);

module.exports = router;
