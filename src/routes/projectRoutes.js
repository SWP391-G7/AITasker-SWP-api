/**
 * Backend module: routes/projectRoutes.js
 *
 * Vai trò: Route project Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createProject,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject
} = require('../controllers/projectController');

const disputeRoutes = require('./disputeRoutes');

// All project routes require authentication
router.use(protect);

router.use('/:id/dispute', disputeRoutes);
router.post('/', createProject);
router.get('/', getMyProjects);
router.get('/:id', getProjectById);
router.put('/:id', updateProject);
router.delete('/:id', deleteProject);

module.exports = router;

