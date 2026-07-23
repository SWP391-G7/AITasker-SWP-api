/**
 * Backend module: routes/proposalRoutes.js
 *
 * Vai trò: Route proposal Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express')
const router = express.Router()
const {
  createProposal,
  getMyProposals,
  getProposalsByJob,
  getProposalById,
  updateProposal,
  deleteProposal,
  updateProposalStatus,
  counterProposal
} = require('../controllers/proposalController')
const { protect } = require('../middleware/authMiddleware')

// POST /api/proposals              - Create a proposal (expert only)
router.post('/', protect, createProposal)

// GET  /api/proposals/my           - Get all proposals by the authenticated expert
router.get('/my', protect, getMyProposals)

// GET  /api/proposals/job/:jobId   - Get proposals for a specific job
router.get('/job/:jobId', protect, getProposalsByJob)

// GET  /api/proposals/:id          - Get a single proposal by ID
router.get('/:id', protect, getProposalById)

// PUT  /api/proposals/:id/status   - Update proposal status (accept/reject)
router.put('/:id/status', protect, updateProposalStatus)

// PUT  /api/proposals/:id/counter  - Counter a proposal with a new bid
router.put('/:id/counter', protect, counterProposal)

// PUT  /api/proposals/:id          - Update proposal fields (expert owner only)
router.put('/:id', protect, updateProposal)

// DELETE /api/proposals/:id        - Delete a proposal (expert owner only)
router.delete('/:id', protect, deleteProposal)

module.exports = router
