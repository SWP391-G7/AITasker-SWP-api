const express = require('express');
const router = express.Router();
const { searchEntities } = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/search - Search and filter resources (public access)
router.get('/', searchEntities);

module.exports = router;
