const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');

/**
 * @desc    Initiate payment process for a proposal
 * @route   POST /api/payment/pay-proposal/:proposalId
 * @access  Private (Client only)
 */
const initiateProposalPayment = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { proposalId } = req.params;

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can initiate proposal payments');
    err.statusCode = 403;
    return next(err);
  }

  try {
    // Query proposal, job status, and client budget
    const proposalQuery = `
      SELECT p.*, j.title as job_title, j.status as job_status, cp.budget as client_budget, cp.id as client_id
      FROM proposals p
      JOIN job_posts j ON p.job_id = j.id
      JOIN client_profiles cp ON j.client_id = cp.id
      WHERE p.id = $1;
    `;
    const result = await pool.query(proposalQuery, [proposalId]);

    if (result.rows.length === 0) {
      const err = new Error('Proposal not found');
      err.statusCode = 404;
      return next(err);
    }

    const proposal = result.rows[0];

    // Check ownership
    if (proposal.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only accept proposals for jobs you posted');
      err.statusCode = 403;
      return next(err);
    }

    // Verify job is open (or pending — proposal already paid but project not yet started)
    if (proposal.job_status !== 'open' && proposal.job_status !== 'pending') {
      const err = new Error('Cannot accept proposal: The job post is no longer open');
      err.statusCode = 400;
      return next(err);
    }

    // Verify proposal is pending or countered
    if (proposal.status !== 'pending' && proposal.status !== 'countered') {
      const err = new Error(`Cannot accept proposal with status: ${proposal.status}`);
      err.statusCode = 400;
      return next(err);
    }

    // Determine target bid amount
    let bidAmount = parseFloat(proposal.bid_amount);
    if (proposal.status === 'countered' && proposal.counter_bid_amount) {
      bidAmount = parseFloat(proposal.counter_bid_amount);
    }

    // Verify client budget
    const clientBudget = parseFloat(proposal.client_budget || 0);
    if (clientBudget < bidAmount) {
      const err = new Error('Your budget is not enough to choose this proposal');
      err.statusCode = 400;
      return next(err);
    }

    // Generate self-contained temporary token (expires in 15 minutes)
    const tokenPayload = {
      proposalId: proposal.id,
      clientId: proposal.client_id,
      amount: bidAmount,
      jobId: proposal.job_id,
      jobTitle: proposal.job_title
    };
    
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'aitasker-super-secret-key-2026',
      { expiresIn: '15m' }
    );

    // Return redirect URL structure
    const redirectUrl = `/mock-payment-gateway/${token}`;

    return res.status(200).json({
      success: true,
      redirectUrl,
      token,
      amount: bidAmount,
      jobTitle: proposal.job_title
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Simulate charging credit card (Third Party Mock Service)
 * @route   POST /api/payment/mock-charge
 * @access  Public
 */
const mockChargeCard = async (req, res, next) => {
  const { token, cardNumber, cardHolder, expiry, cvv } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: 'Payment session token is required' });
  }

  // Verify and decode payment session token
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'aitasker-super-secret-key-2026');
  } catch (err) {
    return res.status(400).json({ success: false, message: 'Invalid or expired payment session token' });
  }

  // Validate card format
  const sanitizedCard = (cardNumber || '').replace(/\s/g, '');
  if (!sanitizedCard || sanitizedCard.length !== 16 || isNaN(sanitizedCard)) {
    return res.status(400).json({ success: false, message: 'Card number must be 16 digits' });
  }

  if (!cardHolder || cardHolder.trim() === '') {
    return res.status(400).json({ success: false, message: 'Cardholder name is required' });
  }

  if (!expiry || !/^\d{2}\/\d{2}$/.test(expiry)) {
    return res.status(400).json({ success: false, message: 'Expiry date must be MM/YY' });
  }

  if (!cvv || cvv.length !== 3 || isNaN(cvv)) {
    return res.status(400).json({ success: false, message: 'CVV must be 3 digits' });
  }

  // Handle mock failure conditions
  if (cvv === '999') {
    const errorMsg = 'Payment details invalid: Suspected fraud / Card declined.';
    console.error(`[Mock 3rd Party Payment Error] Fraud trigger CVV=999. Card: ${sanitizedCard}. Name: ${cardHolder}`);
    return res.status(400).json({ success: false, message: errorMsg });
  }

  if (sanitizedCard === '4111111111111111') {
    const errorMsg = 'Payment details invalid: Insufficient funds.';
    console.error(`[Mock 3rd Party Payment Error] Insufficient funds trigger. Card: ${sanitizedCard}`);
    return res.status(400).json({ success: false, message: errorMsg });
  }

  // Card is validated. Send cryptographic webhook request to merchant app
  const webhookPayload = {
    type: payload.type || 'proposal',
    proposalId: payload.proposalId,
    invitationId: payload.invitationId,
    clientId: payload.clientId,
    expertId: payload.expertId,
    amount: payload.amount,
    jobId: payload.jobId
  };

  const webhookSecret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-payment-webhook-secret';
  const postData = JSON.stringify(webhookPayload);
  const signature = crypto.createHmac('sha256', webhookSecret).update(postData).digest('hex');

  const port = req.socket.localPort || process.env.PORT || 5000;
  
  const options = {
    hostname: 'localhost',
    port: port,
    path: '/api/payment/webhook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      'X-Mock-Signature': signature
    }
  };

  const webhookReq = http.request(options, (webhookRes) => {
    let data = '';
    webhookRes.on('data', (chunk) => {
      data += chunk;
    });

    webhookRes.on('end', () => {
      try {
        const parsedData = JSON.parse(data);
        if (webhookRes.statusCode === 200 && parsedData.success) {
          // Build redirect URL based on payment type
          let redirectUrl;
          if (payload.type === 'invitation') {
            redirectUrl = `/service-requests/${payload.invitationId}?payment=success`;
          } else {
            redirectUrl = `/client/projects/${payload.jobId}?payment=success&proposalId=${payload.proposalId}`;
          }
          return res.status(200).json({
            success: true,
            message: 'Payment charged and escrowed successfully',
            redirectUrl
          });
        } else {
          return res.status(webhookRes.statusCode || 500).json({
            success: false,
            message: parsedData.message || 'Payment webhook processing failed'
          });
        }
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: 'Invalid response from payment webhook'
        });
      }
    });
  });

  webhookReq.on('error', (error) => {
    console.error('[Mock 3rd Party Payment Webhook Error]:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to dispatch payment webhook'
    });
  });

  webhookReq.write(postData);
  webhookReq.end();
};

/**
 * @desc    Cryptographic webhook receiver from payment processor
 * @route   POST /api/payment/webhook
 * @access  Public (Requires signature verification)
 */
const handlePaymentWebhook = async (req, res, next) => {
  const signature = req.headers['x-mock-signature'];
  const webhookPayload = req.body;

  if (!signature) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Missing signature header' });
  }

  const webhookSecret = process.env.MOCK_PAYMENT_WEBHOOK_SECRET || 'mock-payment-webhook-secret';
  const payloadStr = JSON.stringify(webhookPayload);
  const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(payloadStr).digest('hex');

  // Verify HMAC signature
  if (signature !== expectedSignature) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Cryptographic signature mismatch' });
  }

  const { type, proposalId, invitationId, clientId, expertId: webhookExpertId, amount, jobId } = webhookPayload;
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    // ── INVITATION PAYMENT FLOW ──────────────────────────────────────
    if (type === 'invitation') {
      // 1. Verify invitation is accepted (expert approved) and not yet paid
      const invRes = await dbClient.query(
        `SELECT i.*, s.expert_id, s.title as service_title
         FROM invitations i JOIN services s ON i.service_id = s.id
         WHERE i.id = $1 FOR UPDATE`,
        [invitationId]
      );
      if (invRes.rows.length === 0) throw new Error('Precondition failed: Invitation not found');
      const inv = invRes.rows[0];
      if (inv.status !== 'accepted') throw new Error(`Precondition failed: Invitation status must be accepted, got ${inv.status}`);
      if (inv.paid_at) throw new Error('Precondition failed: This invitation has already been paid');

      const expertId = inv.expert_id;
      const serviceTitle = inv.service_title;

      // 2. Client budget check
      const clientRes = await dbClient.query('SELECT budget FROM client_profiles WHERE id = $1 FOR UPDATE', [clientId]);
      if (clientRes.rows.length === 0) throw new Error('Precondition failed: Client profile not found');
      const clientBudget = parseFloat(clientRes.rows[0].budget || 0);
      if (clientBudget < parseFloat(amount)) throw new Error('Precondition failed: Client has insufficient budget');

      // A. Deduct client budget
      await dbClient.query('UPDATE client_profiles SET budget = budget - $1 WHERE id = $2', [amount, clientId]);

      // B. Mark invitation as paid (set paid_at timestamp; status stays 'accepted')
      await dbClient.query('UPDATE invitations SET paid_at = CURRENT_TIMESTAMP WHERE id = $1', [invitationId]);

      // C. Save transaction record
      const txRes = await dbClient.query(`
        INSERT INTO transactions (sender_id, receiver_id, amount, type, status, complete_at)
        VALUES ($1, $2, $3, 'escrow_deposit', 'completed', CURRENT_TIMESTAMP)
        RETURNING id;
      `, [clientId, expertId, amount]);
      const transactionId = txRes.rows[0].id;

      // D. Save payment record
      await dbClient.query(`
        INSERT INTO payments (transaction_id, user_id, amount, type, paid_at)
        VALUES ($1, $2, $3, 'credit_card', CURRENT_TIMESTAMP);
      `, [transactionId, clientId, amount]);

      await dbClient.query('COMMIT');

      // Notify expert that payment was received
      try {
        const { sendNotification } = require('../utils/notificationService');
        await sendNotification(expertId, {
          title: 'Service Request Paid',
          message: `The client has completed payment for the service request "${serviceTitle}". The project can now be started.`,
          type: 'service_request_paid',
          referenceId: invitationId
        });
      } catch (notifErr) {
        console.error('[Notification Trigger Error] handlePaymentWebhook (invitation):', notifErr.message);
      }

      return res.status(200).json({ success: true, message: 'Invitation payment processed successfully.' });
    }

    // ── PROPOSAL PAYMENT FLOW (default) ─────────────────────────────
    // 1. Job post is open
    const jobRes = await dbClient.query('SELECT status, title FROM job_posts WHERE id = $1 FOR UPDATE', [jobId]);
    if (jobRes.rows.length === 0) {
      throw new Error('Precondition failed: Job post not found');
    }
    if (jobRes.rows[0].status !== 'open') {
      throw new Error('Precondition failed: Job post status must be open');
    }
    const jobTitle = jobRes.rows[0].title;

    // 2. Selected proposal is pending or countered
    const proposalRes = await dbClient.query('SELECT status, expert_id FROM proposals WHERE id = $1 FOR UPDATE', [proposalId]);
    if (proposalRes.rows.length === 0) {
      throw new Error('Precondition failed: Proposal not found');
    }
    if (proposalRes.rows[0].status !== 'pending' && proposalRes.rows[0].status !== 'countered') {
      throw new Error(`Precondition failed: Proposal status must be pending or countered, got ${proposalRes.rows[0].status}`);
    }
    const expertId = proposalRes.rows[0].expert_id;

    // 3. Client budget >= proposal budget
    const clientRes = await dbClient.query('SELECT budget FROM client_profiles WHERE id = $1 FOR UPDATE', [clientId]);
    if (clientRes.rows.length === 0) {
      throw new Error('Precondition failed: Client profile not found');
    }
    const clientBudget = parseFloat(clientRes.rows[0].budget || 0);
    if (clientBudget < parseFloat(amount)) {
      throw new Error('Precondition failed: Client has insufficient budget');
    }

    // Execute Postconditions
    // A. Client budget decreases
    await dbClient.query('UPDATE client_profiles SET budget = budget - $1 WHERE id = $2', [amount, clientId]);

    // B. Status of selected proposal changes to "Accepted"
    await dbClient.query('UPDATE proposals SET status = \'accepted\', bid_amount = $1 WHERE id = $2', [amount, proposalId]);

    // C. Status of remaining proposals changes to "Rejected"
    await dbClient.query('UPDATE proposals SET status = \'rejected\' WHERE job_id = $1 AND id <> $2', [jobId, proposalId]);

    // D. Job post moves to 'pending' — awaiting project creation by client
    await dbClient.query("UPDATE job_posts SET status = 'pending' WHERE id = $1", [jobId]);

    // E. Save transaction record (completed deposit in escrow)
    const transactionRes = await dbClient.query(`
      INSERT INTO transactions (sender_id, receiver_id, amount, type, status, complete_at)
      VALUES ($1, $2, $3, 'escrow_deposit', 'completed', CURRENT_TIMESTAMP)
      RETURNING id;
    `, [clientId, expertId, amount]);
    const transactionId = transactionRes.rows[0].id;

    // F. Save payment record
    await dbClient.query(`
      INSERT INTO payments (transaction_id, user_id, amount, type, paid_at)
      VALUES ($1, $2, $3, 'credit_card', CURRENT_TIMESTAMP);
    `, [transactionId, clientId, amount]);

    await dbClient.query('COMMIT');

    // Trigger Notification to Expert
    try {
      const { sendNotification } = require('../utils/notificationService');
      await sendNotification(expertId, {
        title: "Proposal Accepted",
        message: `Your proposal for the job "${jobTitle}" has been accepted.`,
        type: "proposal_accepted",
        referenceId: proposalId
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] handlePaymentWebhook:', notifErr.message);
    }

    return res.status(200).json({ success: true, message: 'Webhook processes payment successfully. State updated.' });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('[Webhook Precondition/Execution Failure]:', error.message);
    return res.status(400).json({ success: false, message: error.message });
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Initiate payment process for an accepted service-request invitation
 * @route   POST /api/payment/pay-invitation/:invitationId
 * @access  Private (Client only)
 */
const initiateInvitationPayment = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { invitationId } = req.params;

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can initiate invitation payments');
    err.statusCode = 403;
    return next(err);
  }

  try {
    // Query invitation with service and client budget
    const invQuery = `
      SELECT i.*, s.title as service_title, s.expert_id,
             cp.budget as client_budget
      FROM invitations i
      JOIN services s ON i.service_id = s.id
      JOIN client_profiles cp ON i.client_id = cp.id
      WHERE i.id = $1;
    `;
    const result = await pool.query(invQuery, [invitationId]);

    if (result.rows.length === 0) {
      const err = new Error('Service request not found');
      err.statusCode = 404;
      return next(err);
    }

    const invitation = result.rows[0];

    // Ownership check
    if (invitation.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only pay for your own service requests');
      err.statusCode = 403;
      return next(err);
    }

    // Must be accepted by the expert (not yet paid)
    if (invitation.status !== 'accepted') {
      const err = new Error(`Cannot pay for a request with status: ${invitation.status}. The expert must accept first.`);
      err.statusCode = 400;
      return next(err);
    }

    // Already paid?
    if (invitation.paid_at) {
      const err = new Error('This request has already been paid. You can now start the project.');
      err.statusCode = 400;
      return next(err);
    }

    // Determine the final bid amount
    const bidAmount = parseFloat(invitation.bid_amount);

    // Budget check
    const clientBudget = parseFloat(invitation.client_budget || 0);
    if (clientBudget < bidAmount) {
      const err = new Error('Your budget is insufficient for this service request');
      err.statusCode = 400;
      return next(err);
    }

    // Build JWT token payload (includes type: 'invitation' to distinguish in webhook)
    const tokenPayload = {
      type: 'invitation',
      invitationId: invitation.id,
      clientId: invitation.client_id,
      expertId: invitation.expert_id,
      amount: bidAmount,
      jobTitle: invitation.service_title
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'aitasker-super-secret-key-2026',
      { expiresIn: '15m' }
    );

    const redirectUrl = `/mock-payment-gateway/${token}`;

    return res.status(200).json({
      success: true,
      redirectUrl,
      token,
      amount: bidAmount,
      jobTitle: invitation.service_title
    });

  } catch (error) {
    return next(error);
  }
};

module.exports = {
  initiateProposalPayment,
  initiateInvitationPayment,
  mockChargeCard,
  handlePaymentWebhook
};
