const express = require('express');
const router = express.Router();
const {
  getAllContent,
  setContentStatus,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  deactivateUser
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Guard all admin routes with authentication and role checking
router.use(protect, authorize(['admin']));

// Content Moderation endpoints
router.get('/content', getAllContent);
router.put('/content/:contentType/:id/status', setContentStatus);

// User Management endpoints
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/status', deactivateUser);

module.exports = router;
