const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  submitMilestonePlan,
  getMilestonesByProject,
  approveMilestonePlan,
  requestPlanChanges,
  updateMilestone,
  deleteMilestone,
  startMilestone,
  submitDeliverable,
  approveDeliverable,
  requestRevision,
  payMilestone,
  approveMilestone,
  declineMilestone,
  submitMilestoneResponse,
  submitMilestoneContent,
  startProject,
  getMilestoneById,
} = require('../controllers/milestoneController');

// All milestone routes require authentication
router.use(protect);

// ── Project-level routes (must come BEFORE /:id routes) ──────────────────────
router.post('/project/:projectId/submit-plan',  submitMilestonePlan);
router.get( '/project/:projectId',              getMilestonesByProject);
router.put( '/project/:projectId/approve-plan', approveMilestonePlan);
router.put( '/project/:projectId/request-changes', requestPlanChanges);
router.put( '/project/:projectId/start',        startProject);

// ── Milestone-level routes ───────────────────────────────────────────────────
router.get('/:id',                     getMilestoneById);
router.put('/:id/start',               startMilestone);
router.put('/:id/submit-deliverable',   submitDeliverable);
router.put('/:id/approve-deliverable',  approveDeliverable);
router.put('/:id/request-revision',     requestRevision);
router.put('/:id/pay',                  payMilestone);
router.put('/:id/approve',              approveMilestone);
router.put('/:id/decline',              declineMilestone);
router.put('/:id/response',             submitMilestoneResponse);
router.put('/:id/submit-content',       submitMilestoneContent);
router.put('/:id',                      updateMilestone);
router.delete('/:id',                   deleteMilestone);

module.exports = router;

