/**
 * Backend module: routes/transactionRoutes.js
 *
 * Vai trò: Route transaction Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { getMyTransactions } = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/', getMyTransactions);

module.exports = router;
