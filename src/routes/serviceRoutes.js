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

// GET /api/services/:id - Get a single service by ID (all authenticated users)
router.get('/:id', protect, getServiceById)

// PUT /api/services/:id - Update a service (Experts only)
router.put('/:id', protect, authorize(['expert']), updateService)

// DELETE /api/services/:id - Delete a service (Experts only)
router.delete('/:id', protect, authorize(['expert']), deleteService)

module.exports = router
