/**
 * Backend module: routes/profileRoutes.js
 *
 * Vai trò: Route profile Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { getUserProfile, updateClientProfile, updateExpertProfile, updateUserRole } = require('../controllers/profileController');
const { protect } = require('../middleware/authMiddleware');

// Get profile by user ID (public access)
router.get('/:userId', getUserProfile);

// Update user role
router.put('/role', protect, updateUserRole);

// Update client profile details
router.put('/client', protect, updateClientProfile);

// Update expert profile details
router.put('/expert', protect, updateExpertProfile);

module.exports = router;
