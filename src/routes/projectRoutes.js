const express = require('express');
const router = express.Router();
<<<<<<< Updated upstream
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
=======
const { protect } = require('../middleware/authMiddleware');
const {
  createProject,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject
} = require('../controllers/projectController');

// All project routes require authentication
router.use(protect);

router.route('/')
  .post(createProject)
  .get(getMyProjects);

router.route('/:id')
  .get(getProjectById)
  .put(updateProject)
  .delete(deleteProject);
>>>>>>> Stashed changes

module.exports = router;
