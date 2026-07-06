const express = require('express');
const router = express.Router();
const { register, login, getMe, googleLogin } = require('../controllers/authController');
const { sendCodeToEmail, verifyCode } = require('../controllers/emailVerificationController');
const { requestPasswordReset, resetPassword } = require('../controllers/passwordResetController');
const { protect } = require('../middleware/authMiddleware');

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.post('/google', googleLogin);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);

// Email verification routes
router.post('/send-verification-code', sendCodeToEmail);
router.post('/verify-code', verifyCode);

module.exports = router;
