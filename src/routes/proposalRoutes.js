const express = require('express')
const router = express.Router()
const {
  createProposal,
  getProposalsByJob,
  updateProposal,
  deleteProposal,
  updateProposalStatus,
  counterProposal
} = require('../controllers/proposalController')
const { protect } = require('../middleware/authMiddleware')

// POST /api/proposals - Create a proposal (expert only)
router.post('/', protect, createProposal)

// GET /api/proposals/job/:jobId - Get proposals for a specific job
router.get('/job/:jobId', protect, getProposalsByJob)

// PUT /api/proposals/:id/status - Update proposal status (accept/reject)
router.put('/:id/status', protect, updateProposalStatus)

// PUT /api/proposals/:id/counter - Counter a proposal with a new bid
router.put('/:id/counter', protect, counterProposal)

// PUT /api/proposals/:id - Update a proposal fields (expert owner only)
router.put('/:id', protect, updateProposal)

// DELETE /api/proposals/:id - Delete a proposal (expert owner only)
router.delete('/:id', protect, deleteProposal)

module.exports = router
