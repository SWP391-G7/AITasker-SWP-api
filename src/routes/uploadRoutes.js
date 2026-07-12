const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const { uploadImage } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

// Using upload.any() to handle any field name (like 'image', 'file', or 'attachment')
router.post('/', protect, upload.any(), uploadImage);

module.exports = router;
