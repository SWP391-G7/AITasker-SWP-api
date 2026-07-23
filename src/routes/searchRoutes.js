/**
 * Backend module: routes/searchRoutes.js
 *
 * Vai trò: Route search Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { searchEntities } = require('../controllers/searchController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/search - Search and filter resources (public access)
router.get('/', searchEntities);

module.exports = router;
