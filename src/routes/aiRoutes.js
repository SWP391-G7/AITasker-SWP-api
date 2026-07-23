const express = require('express');
const router = express.Router();
const { generateFormFields } = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/ai/generate - Call Google Gemini to generate structured fields
router.post('/generate', protect, generateFormFields);

module.exports = router;
