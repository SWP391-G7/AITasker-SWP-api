const express = require('express');
const router = express.Router();
const { createJobPost, getMyJobs } = require('../controllers/jobController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/jobs - Create a new job post
router.post('/', protect, createJobPost);

// GET /api/jobs/my - Get all job posts created by the current user
router.get('/my', protect, getMyJobs);

module.exports = router;
