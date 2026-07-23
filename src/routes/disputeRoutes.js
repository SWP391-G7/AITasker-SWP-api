/**
 * Backend module: routes/disputeRoutes.js
 *
 * Vai trò: Route dispute Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const { raiseDispute, getProjectDispute } = require('../controllers/disputeController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/', raiseDispute);
router.get('/', getProjectDispute);

module.exports = router;
