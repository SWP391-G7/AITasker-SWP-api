const express = require('express');
const router = express.Router();
const { rateTarget, getRatingById } = require('../controllers/ratingController');
const { protect } = require('../middleware/authMiddleware');

// Route to submit a rating (Requires auth)
router.post('/', protect, rateTarget);

// Route to get rating details by ID (Public)
router.get('/:id', getRatingById);

module.exports = router;
