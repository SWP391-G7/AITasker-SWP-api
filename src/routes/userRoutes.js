const express = require('express');
const router = express.Router();
const { updateFullname, updateEmail, updatePassword } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.put('/update-fullname', protect, updateFullname);
router.put('/update-email', protect, updateEmail);
router.put('/update-password', protect, updatePassword);

module.exports = router;
