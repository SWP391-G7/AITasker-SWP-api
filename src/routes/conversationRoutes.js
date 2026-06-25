const express = require('express');
const router = express.Router();
const { getConversations, getOrCreateConversation, getConversationMessages } = require('../controllers/conversationController');
const { protect } = require('../middleware/authMiddleware');

// Get all conversations for logged-in user
router.get('/', protect, getConversations);

// Create or retrieve conversation with another user
router.post('/', protect, getOrCreateConversation);

// Get messages in a conversation
router.get('/:id/messages', protect, getConversationMessages);

module.exports = router;
