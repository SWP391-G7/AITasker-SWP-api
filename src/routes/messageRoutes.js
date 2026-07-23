const express = require('express');
const router = express.Router();
const { createMessage, removeMessage } = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

// Send a message
router.post('/', protect, createMessage);

// Remove a message (soft-delete)
router.delete('/:id', protect, removeMessage);

module.exports = router;

