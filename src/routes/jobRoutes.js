const express = require('express')
const router = express.Router()
const { createJobPost, getMyJobs, getJobById, updateJobPost, deleteJobPost } = require('../controllers/jobController')
const { protect, authorize } = require('../middleware/authMiddleware')

// POST /api/jobs - Create a new job post
router.post('/', protect, authorize(['client', 'admin']), createJobPost)

// GET /api/jobs/my - Get all job posts created by the current user
router.get('/my', protect, authorize(['client', 'admin']), getMyJobs)

// GET /api/jobs/:id - Get a single job post by ID (any authenticated user can view)
router.get('/:id', protect, getJobById)

// PUT /api/jobs/:id - Update a job post
router.put('/:id', protect, authorize(['client', 'admin']), updateJobPost)

// DELETE /api/jobs/:id - Delete a job post
router.delete('/:id', protect, authorize(['client', 'admin']), deleteJobPost)

module.exports = router
