/**
 * Backend module: routes/authRoutes.js
 *
 * Vai trò: Route auth Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { register, login, getMe, googleLogin, forgotPassword, verifyPasswordResetCode, resetPassword } = require('../controllers/authController');
const { sendCodeToEmail, verifyCode } = require('../controllers/emailVerificationController');
const { protect } = require('../middleware/authMiddleware');

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin);
router.get('/me', protect, getMe);

// Password reset routes
router.post('/forgot-password', forgotPassword);
router.post('/verify-reset-code', verifyPasswordResetCode);
router.post('/reset-password', resetPassword);

// Email verification routes
router.post('/send-verification-code', sendCodeToEmail);
router.post('/verify-code', verifyCode);

module.exports = router;

