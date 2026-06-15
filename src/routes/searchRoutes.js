const express = require('express');
const router = express.Router();
const { searchEntities } = require('../controllers/searchController');

// GET /api/search - Search and filter resources (public endpoint)
router.get('/', searchEntities);

module.exports = router;
