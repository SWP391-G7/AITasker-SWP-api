/**
 * Backend module: routes/paymentRoutes.js
 *
 * Vai trò: Route payment Routes: ánh xạ HTTP method và URL tới controller tương ứng.
 * Luồng chính: Middleware xác thực/phân quyền/upload chạy theo thứ tự khai báo trước khi request tới controller.
 * Lưu ý bảo trì: Thứ tự route quan trọng; route động có tham số không được che khuất route tĩnh.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  initiateProposalPayment,
  initiateInvitationPayment,
  mockChargeCard,
  handlePaymentWebhook
} = require('../controllers/paymentController');

// POST /api/payment/pay-proposal/:proposalId - Initiate payment link/session (Protected)
router.post('/pay-proposal/:proposalId', protect, initiateProposalPayment);
router.post('/pay-invitation/:invitationId', protect, initiateInvitationPayment);

// POST /api/payment/pay-invitation/:invitationId - Initiate payment for an accepted service request (Protected)
router.post('/pay-invitation/:invitationId', protect, initiateInvitationPayment);

// POST /api/payment/mock-charge - Simulate payment gateway card charge (Public)
router.post('/mock-charge', mockChargeCard);

// POST /api/payment/webhook - Handle payment gateway webhook callback (Public)
router.post('/webhook', handlePaymentWebhook);

module.exports = router;
