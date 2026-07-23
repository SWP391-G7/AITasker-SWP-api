/**
 * Backend module: routes/jobRoutes.js
 *
 * Vai trò: Route job Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express')
const router = express.Router()
const { createJobPost, getMyJobs, getJobById, updateJobPost, deleteJobPost } = require('../controllers/jobController')
const { protect, authorize } = require('../middleware/authMiddleware')

// POST /api/jobs - Create a new job post
router.post('/', protect, authorize(['client', 'admin']), createJobPost)

// GET /api/jobs/my - Get all job posts created by the current user
router.get('/my', protect, authorize(['client', 'admin']), getMyJobs)

// GET /api/jobs/:id - Get a single job post by ID (public access)
router.get('/:id', getJobById)

// PUT /api/jobs/:id - Update a job post
router.put('/:id', protect, authorize(['client', 'admin']), updateJobPost)

// DELETE /api/jobs/:id - Delete a job post
router.delete('/:id', protect, authorize(['client', 'admin']), deleteJobPost)

module.exports = router
