const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../controllers/authController');
const { sendCodeToEmail, verifyCode } = require('../controllers/emailVerificationController');
const { protect } = require('../middleware/authMiddleware');

// Authentication routes
router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);

// Email verification routes
router.post('/send-verification-code', sendCodeToEmail);
router.post('/verify-code', verifyCode);

module.exports = router;
