/**
 * Backend module: routes/aiRoutes.js
 *
 * Vai trò: Route ai Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { generateFormFields } = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

// POST /api/ai/generate - Call Google Gemini to generate structured fields
router.post('/generate', protect, generateFormFields);

module.exports = router;
