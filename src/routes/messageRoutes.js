/**
 * Backend module: routes/messageRoutes.js
 *
 * Vai trò: Route message Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { createMessage, removeMessage } = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');

// Send a message
router.post('/', protect, createMessage);

// Remove a message (soft-delete)
router.delete('/:id', protect, removeMessage);

module.exports = router;

