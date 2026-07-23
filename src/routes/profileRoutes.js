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
