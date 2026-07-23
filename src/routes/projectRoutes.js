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

