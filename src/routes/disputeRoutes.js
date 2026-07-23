const express = require('express');
const router = express.Router({ mergeParams: true });
const { raiseDispute, getProjectDispute } = require('../controllers/disputeController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/', raiseDispute);
router.get('/', getProjectDispute);

module.exports = router;
