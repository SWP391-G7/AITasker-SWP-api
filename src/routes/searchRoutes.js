const express = require('express');
const router = express.Router();
const { searchEntities } = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/search - Search and filter resources (requires authentication)
router.get('/', protect, searchEntities);

module.exports = router;
