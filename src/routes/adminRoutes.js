/**
 * Backend module: routes/adminRoutes.js
 *
 * Vai trò: Route admin Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const {
  getAnalytics,
  getAllContent,
  setContentStatus,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  deactivateUser,
  getDisputes,
  resolveDispute
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/authMiddleware');

// Guard all admin routes with authentication and role checking
router.use(protect, authorize(['admin']));

// Platform Analytics endpoint
router.get('/analytics', getAnalytics);

// Content Moderation endpoints
router.get('/content', getAllContent);
router.put('/content/:contentType/:id/status', setContentStatus);

// Dispute Resolution endpoints
router.get('/disputes', getDisputes);
router.post('/disputes/:id/resolve', resolveDispute);

// User Management endpoints
router.get('/users', getUsers);
router.get('/users/:id', getUserById);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.patch('/users/:id/status', deactivateUser);

module.exports = router;
