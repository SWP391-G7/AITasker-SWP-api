/**
 * Backend module: routes/invitationRoutes.js
 *
 * Vai trò: Route invitation Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express')
const router = express.Router()
const {
  createInvitation,
  getMyInvitations,
  getInvitationById,
  updateInvitationStatus,
  counterInvitation,
  startProject
} = require('../controllers/invitationController')
const { protect } = require('../middleware/authMiddleware')

// POST /api/invitations              - Create a service request/invitation (client only)
router.post('/', protect, createInvitation)

// GET  /api/invitations/my           - Get invitations for the authenticated user
router.get('/my', protect, getMyInvitations)

// GET  /api/invitations/:id          - Get a single invitation by ID
router.get('/:id', protect, getInvitationById)

// PUT  /api/invitations/:id/status   - Accept/reject an invitation
router.put('/:id/status', protect, updateInvitationStatus)

// PUT  /api/invitations/:id/counter  - Counter-propose an invitation (change price/delivery days)
router.put('/:id/counter', protect, counterInvitation)

// POST /api/invitations/:id/start-project - Start a project from accepted invitation (client only)
router.post('/:id/start-project', protect, startProject)

module.exports = router
