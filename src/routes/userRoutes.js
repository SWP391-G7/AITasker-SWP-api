const express = require('express');
const router = express.Router();
const { updateFullname, updateEmail, updatePassword, updateAvatar } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.put('/update-fullname', protect, updateFullname);
router.put('/update-email', protect, updateEmail);
router.put('/update-password', protect, updatePassword);
router.put('/update-avatar', protect, updateAvatar);

module.exports = router;
