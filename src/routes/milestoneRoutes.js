const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createMilestone,
  getMilestonesByProject,
  updateMilestone,
  deleteMilestone,
  payMilestone
} = require('../controllers/milestoneController');

// All milestone routes require authentication
router.use(protect);

router.post('/project/:projectId', createMilestone);
router.get('/project/:projectId', getMilestonesByProject);
router.put('/:id', updateMilestone);
router.delete('/:id', deleteMilestone);
router.put('/:id/pay', payMilestone);

module.exports = router;
