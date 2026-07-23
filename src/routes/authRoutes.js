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

