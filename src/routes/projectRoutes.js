const express = require('express');
const router = express.Router();
const {
  createProject,
  getMyProjects,
  updateProject,
  deleteProject
} = require('../controllers/projectController');
const { protect } = require('../middleware/authMiddleware');

// GET /api/projects/my - Return "my" projects (projects associated with current user)
router.get('/my', protect, getMyProjects);

// POST /api/projects - Create a new project
router.post('/', protect, createProject);

// PUT /api/projects/:id - Update an existing project
router.put('/:id', protect, updateProject);

// DELETE /api/projects/:id - Delete an existing project
router.delete('/:id', protect, deleteProject);

module.exports = router;
