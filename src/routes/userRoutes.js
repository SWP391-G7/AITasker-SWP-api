const express = require('express');
const router = express.Router();
const { updateFullname, updateEmail, updatePassword, switchRole } = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.put('/update-fullname', protect, updateFullname);
router.put('/update-email', protect, updateEmail);
router.put('/update-password', protect, updatePassword);
router.post('/switch-role', protect, switchRole);

module.exports = router;
