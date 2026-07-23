/**
 * Backend module: routes/serviceRoutes.js
 *
 * Vai trò: Route service Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express')
const router = express.Router()
const {
  createService,
  getMyServices,
  getServiceById,
  updateService,
  deleteService
} = require('../controllers/serviceController')
const { protect, authorize } = require('../middleware/authMiddleware')

// POST /api/services - Create a new service listing (Experts only)
router.post('/', protect, authorize(['expert']), createService)

// GET /api/services/my - Get all services created by the current expert
router.get('/my', protect, authorize(['expert']), getMyServices)

// GET /api/services/:id - Get a single service by ID (public access)
router.get('/:id', getServiceById)

// PUT /api/services/:id - Update a service (Experts only)
router.put('/:id', protect, authorize(['expert']), updateService)

// DELETE /api/services/:id - Delete a service (Experts only)
router.delete('/:id', protect, authorize(['expert']), deleteService)

module.exports = router
