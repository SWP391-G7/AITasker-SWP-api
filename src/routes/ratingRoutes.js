/**
 * Backend module: routes/ratingRoutes.js
 *
 * Vai trò: Route rating Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { rateTarget, getRatingById, getAverageRating } = require('../controllers/ratingController');
const { protect } = require('../middleware/authMiddleware');

// Route to submit a rating (Requires auth)
router.post('/', protect, rateTarget);

// Route to get average rating by ID (Public) - registered before /:id to prevent matching /average as id
router.get('/average/:id', getAverageRating);

// Route to get rating details by ID (Public)
router.get('/:id', getRatingById);

// Route to get average rating by ID (Public)
router.get('/:id/average', getAverageRating);


module.exports = router;
