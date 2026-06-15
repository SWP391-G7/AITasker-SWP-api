const express = require('express')
const router = express.Router()
const { createService } = require('../controllers/serviceController')
const { protect, authorize } = require('../middleware/authMiddleware')

// POST /api/services - Create a new service listing (Experts only)
router.post('/', protect, authorize(['expert']), createService)

module.exports = router
