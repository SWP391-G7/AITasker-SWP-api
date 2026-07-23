/**
 * Backend module: routes/reviewRoutes.js
 *
 * Vai trò: Route review Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { createReview, getReviewByTargetId } = require('../controllers/reviewController');
const { protect } = require('../middleware/authMiddleware');

// Route to submit a review (Requires auth)
router.post('/', protect, createReview);

// Route to get reviews by target user ID (Public)
router.get('/target/:targetId', getReviewByTargetId);

module.exports = router;
