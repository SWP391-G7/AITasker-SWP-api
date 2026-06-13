const express = require('express')
const router = express.Router()
const { createJobPost, getMyJobs, getJobById, updateJobPost, deleteJobPost } = require('../controllers/jobController')
const { protect } = require('../middleware/authMiddleware')

// POST /api/jobs - Create a new job post
router.post('/', protect, createJobPost)

// GET /api/jobs/my - Get all job posts created by the current user
router.get('/my', protect, getMyJobs)

// GET /api/jobs/:id - Get a single job post by ID
router.get('/:id', protect, getJobById)

// PUT /api/jobs/:id - Update a job post
router.put('/:id', protect, updateJobPost)

// DELETE /api/jobs/:id - Delete a job post
router.delete('/:id', protect, deleteJobPost)

module.exports = router
