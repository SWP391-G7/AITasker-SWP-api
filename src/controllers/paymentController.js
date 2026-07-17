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
  const paymentSource = req.body.payment_source || 'card';

  if (!['card', 'wallet', 'combined'].includes(paymentSource)) {
    return res.status(400).json({ success: false, message: 'payment_source must be card, wallet, or combined' });
  }

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
    if (!['pending', 'countered', 'accepted'].includes(proposal.status)) {
      const err = new Error(`Cannot accept proposal with status: ${proposal.status}`);
      err.statusCode = 400;
      return next(err);
    }

    // Determine target bid amount
    let bidAmount = parseFloat(proposal.bid_amount);
    if (proposal.status === 'countered' && proposal.counter_bid_amount) {
      bidAmount = parseFloat(proposal.counter_bid_amount);
    }

    if (proposal.payment_status === 'funded') {
      const err = new Error('This proposal has already been funded');
      err.statusCode = 409;
      return next(err);
    }

    // Allocate the payable amount between available wallet credit and card.
    // Locked escrow is never included in client_profiles.budget.
    const clientBudget = parseFloat(proposal.client_budget || 0);
    if (paymentSource === 'wallet' && clientBudget < bidAmount) {
      const err = new Error('Available wallet balance is not enough for this payment');
      err.statusCode = 400;
      return next(err);
    }
    const walletAmount = paymentSource === 'card' ? 0 : Math.min(clientBudget, bidAmount);
    const cardAmount = bidAmount - walletAmount;

    // Generate self-contained temporary token (expires in 15 minutes)
    const tokenPayload = {
      proposalId: proposal.id,
      clientId: proposal.client_id,
      amount: bidAmount,
      jobId: proposal.job_id,
      jobTitle: proposal.job_title,
      paymentSource,
      walletAmount,
      cardAmount,
      paymentKind: 'proposal'
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
      availableBalance: clientBudget,
      walletAmount,
      cardAmount,
      paymentSource,
      jobTitle: proposal.job_title
    });

  } catch (error) {
    return next(error);
  }
};

const initiateInvitationPayment = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { invitationId } = req.params;
  const paymentSource = req.body.payment_source || 'card';
  if (userRole !== 'client' && userRole !== 'admin') return res.status(403).json({ success: false, message: 'Only clients can fund service requests' });
  if (!['card', 'wallet', 'combined'].includes(paymentSource)) return res.status(400).json({ success: false, message: 'payment_source must be card, wallet, or combined' });

  try {
    const result = await pool.query(`
      SELECT i.*, s.expert_id, s.title AS service_title, cp.budget AS client_budget
      FROM invitations i
      JOIN services s ON i.service_id = s.id
      JOIN client_profiles cp ON i.client_id = cp.id
      WHERE i.id = $1`, [invitationId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Service request not found' });
    const invitation = result.rows[0];
    if (invitation.client_id !== userId && userRole !== 'admin') return res.status(403).json({ success: false, message: 'You can only fund your own service request' });
    if (invitation.status !== 'accepted') return res.status(400).json({ success: false, message: 'The service request terms must be accepted before payment' });
    if (invitation.payment_status === 'funded') return res.status(409).json({ success: false, message: 'This service request has already been funded' });

    const amount = parseFloat(invitation.bid_amount || 0);
    const availableBalance = parseFloat(invitation.client_budget || 0);
    if (paymentSource === 'wallet' && availableBalance < amount) return res.status(400).json({ success: false, message: 'Available wallet balance is not enough for this payment' });
    const walletAmount = paymentSource === 'card' ? 0 : Math.min(availableBalance, amount);
    const cardAmount = amount - walletAmount;
    const token = jwt.sign({
      invitationId: invitation.id,
      clientId: invitation.client_id,
      expertId: invitation.expert_id,
      amount,
      paymentSource,
      walletAmount,
      cardAmount,
      paymentKind: 'invitation',
      serviceTitle: invitation.service_title
    }, process.env.JWT_SECRET || 'aitasker-super-secret-key-2026', { expiresIn: '15m' });

    return res.status(200).json({ success: true, redirectUrl: `/mock-payment-gateway/${token}`, token, amount, availableBalance, walletAmount, cardAmount, paymentSource, serviceTitle: invitation.service_title });
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

  const cardAmount = parseFloat(payload.cardAmount ?? payload.amount);

  // Validate card details only when an external charge is required.
  const sanitizedCard = (cardNumber || '').replace(/\s/g, '');
  if (cardAmount > 0 && (!sanitizedCard || sanitizedCard.length !== 16 || isNaN(sanitizedCard))) {
    return res.status(400).json({ success: false, message: 'Card number must be 16 digits' });
  }

  if (cardAmount > 0 && (!cardHolder || cardHolder.trim() === '')) {
    return res.status(400).json({ success: false, message: 'Cardholder name is required' });
  }

  if (cardAmount > 0 && (!expiry || !/^\d{2}\/\d{2}$/.test(expiry))) {
    return res.status(400).json({ success: false, message: 'Expiry date must be MM/YY' });
  }

  if (cardAmount > 0 && (!cvv || cvv.length !== 3 || isNaN(cvv))) {
    return res.status(400).json({ success: false, message: 'CVV must be 3 digits' });
  }

  // Handle mock failure conditions
  if (cardAmount > 0 && cvv === '999') {
    const errorMsg = 'Payment details invalid: Suspected fraud / Card declined.';
    console.error(`[Mock 3rd Party Payment Error] Fraud trigger CVV=999. Card: ${sanitizedCard}. Name: ${cardHolder}`);
    return res.status(400).json({ success: false, message: errorMsg });
  }

  if (cardAmount > 0 && sanitizedCard === '4111111111111111') {
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
    jobId: payload.jobId,
    paymentSource: payload.paymentSource || 'card',
    walletAmount: parseFloat(payload.walletAmount || 0),
    cardAmount,
    paymentKind: payload.paymentKind || 'proposal'
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
            redirectUrl: (payload.paymentKind === 'invitation' || payload.type === 'invitation')
              ? `/service-requests/${payload.invitationId}?payment=success`
              : `/client/projects/${payload.jobId}?payment=success&proposalId=${payload.proposalId}`
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
  const numericAmount = parseFloat(amount);
  const numericWalletAmount = parseFloat(webhookPayload.walletAmount || 0);
  const numericCardAmount = parseFloat(webhookPayload.cardAmount || 0);
  if (![numericAmount, numericWalletAmount, numericCardAmount].every(Number.isFinite) ||
      numericAmount <= 0 || numericWalletAmount < 0 || numericCardAmount < 0 ||
      Math.abs(numericWalletAmount + numericCardAmount - numericAmount) > 0.01) {
    return res.status(400).json({ success: false, message: 'Invalid payment allocation' });
  }
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    if (webhookPayload.paymentKind === 'invitation' || type === 'invitation') {
      const targetInvitationId = webhookPayload.invitationId || invitationId;
      const invitationRes = await dbClient.query(
        `SELECT i.status, i.payment_status, i.paid_at, i.bid_amount, s.expert_id
         FROM invitations i JOIN services s ON i.service_id = s.id
         WHERE i.id = $1 FOR UPDATE OF i`,
        [targetInvitationId]
      );
      if (!invitationRes.rows.length) throw new Error('Precondition failed: Service request not found');
      const invitation = invitationRes.rows[0];
      if (invitation.status !== 'accepted') throw new Error('Precondition failed: Service request terms are not accepted');
      if (invitation.payment_status === 'funded' || invitation.paid_at) throw new Error('Precondition failed: Service request is already funded');

      const clientRes = await dbClient.query('SELECT budget FROM client_profiles WHERE id = $1 FOR UPDATE', [clientId]);
      const walletAmount = parseFloat(webhookPayload.walletAmount || 0);
      const cardAmount = parseFloat(webhookPayload.cardAmount ?? amount);
      if (!clientRes.rows.length || parseFloat(clientRes.rows[0].budget || 0) < walletAmount) throw new Error('Precondition failed: Available wallet balance is insufficient');

      await dbClient.query('UPDATE client_profiles SET budget = budget - $1 WHERE id = $2', [walletAmount, clientId]);
      await dbClient.query("UPDATE invitations SET payment_status = 'funded', paid_at = CURRENT_TIMESTAMP WHERE id = $1", [targetInvitationId]);
      const txRes = await dbClient.query(`
        INSERT INTO transactions (sender_id, receiver_id, invitation_id, amount, type, status, funding_source, wallet_amount, external_amount, complete_at)
        VALUES ($1, $2, $3, $4, 'escrow_deposit', 'completed', $5, $6, $7, CURRENT_TIMESTAMP)
        RETURNING id`, [clientId, invitation.expert_id, targetInvitationId, amount, webhookPayload.paymentSource || 'card', walletAmount, cardAmount]);
      if (cardAmount > 0) {
        await dbClient.query("INSERT INTO payments (transaction_id, user_id, amount, type, paid_at) VALUES ($1, $2, $3, 'credit_card', CURRENT_TIMESTAMP)", [txRes.rows[0].id, clientId, cardAmount]);
      }
      await dbClient.query('COMMIT');
      return res.status(200).json({ success: true, message: 'Service request funded successfully' });
    }

    // Re-verify Preconditions inside SQL locks
    // 1. Job post is open
    const jobRes = await dbClient.query('SELECT status, title FROM job_posts WHERE id = $1 FOR UPDATE', [jobId]);
    if (jobRes.rows.length === 0) {
      throw new Error('Precondition failed: Job post not found');
    }
    if (!['open', 'pending'].includes(jobRes.rows[0].status)) {
      throw new Error('Precondition failed: Job post must be open or awaiting payment');
    }
    const jobTitle = jobRes.rows[0].title;

    // 2. Selected proposal is pending or countered
    const proposalRes = await dbClient.query('SELECT status, expert_id, payment_status FROM proposals WHERE id = $1 FOR UPDATE', [proposalId]);
    if (proposalRes.rows.length === 0) {
      throw new Error('Precondition failed: Proposal not found');
    }
    if (!['pending', 'countered', 'accepted'].includes(proposalRes.rows[0].status)) {
      throw new Error(`Precondition failed: Proposal cannot be funded from status ${proposalRes.rows[0].status}`);
    }
    if (proposalRes.rows[0].payment_status === 'funded') throw new Error('Precondition failed: Proposal is already funded');
    const expertId = proposalRes.rows[0].expert_id;

    // 3. Client budget >= proposal budget
    const clientRes = await dbClient.query('SELECT budget FROM client_profiles WHERE id = $1 FOR UPDATE', [clientId]);
    if (clientRes.rows.length === 0) {
      throw new Error('Precondition failed: Client profile not found');
    }
    const clientBudget = parseFloat(clientRes.rows[0].budget || 0);
    const walletAmount = parseFloat(webhookPayload.walletAmount || 0);
    const cardAmount = parseFloat(webhookPayload.cardAmount ?? amount);
    if (clientBudget < walletAmount) {
      throw new Error('Precondition failed: Available wallet balance changed and is now insufficient');
    }

    // Execute Postconditions
    // A. Client budget decreases
    await dbClient.query('UPDATE client_profiles SET budget = budget - $1 WHERE id = $2', [walletAmount, clientId]);

    // B. Status of selected proposal changes to "Accepted"
    await dbClient.query("UPDATE proposals SET status = 'accepted', payment_status = 'funded', bid_amount = $1 WHERE id = $2", [amount, proposalId]);

    // C. Status of remaining proposals changes to "Rejected"
    await dbClient.query('UPDATE proposals SET status = \'rejected\' WHERE job_id = $1 AND id <> $2', [jobId, proposalId]);

    // D. Job post moves to 'pending' — awaiting project creation by client
    await dbClient.query("UPDATE job_posts SET status = 'pending' WHERE id = $1", [jobId]);

    // E. Save transaction record (completed deposit in escrow)
    const transactionRes = await dbClient.query(`
      INSERT INTO transactions (sender_id, receiver_id, proposal_id, amount, type, status, funding_source, wallet_amount, external_amount, complete_at)
      VALUES ($1, $2, $3, $4, 'escrow_deposit', 'completed', $5, $6, $7, CURRENT_TIMESTAMP)
      RETURNING id;
    `, [clientId, expertId, proposalId, amount, webhookPayload.paymentSource || 'card', walletAmount, cardAmount]);
    const transactionId = transactionRes.rows[0].id;

    // F. Save payment record
    if (cardAmount > 0) {
      await dbClient.query(`
        INSERT INTO payments (transaction_id, user_id, amount, type, paid_at)
        VALUES ($1, $2, $3, 'credit_card', CURRENT_TIMESTAMP);
      `, [transactionId, clientId, cardAmount]);
    }

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

module.exports = {
  initiateProposalPayment,
  initiateInvitationPayment,
  mockChargeCard,
  handlePaymentWebhook
};
