const express = require('express');
const router = express.Router();
const { createMessage } = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

// Send a message
router.post('/', protect, createMessage);

module.exports = router;
