/**
 * Backend module: routes/conversationRoutes.js
 *
 * Vai trò: Route conversation Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
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
