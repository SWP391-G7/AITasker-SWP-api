const { pool } = require('../config/db')
const { sendNotification } = require('../utils/notificationService')

/**
 * @desc    Create a new proposal for a job post
 * @route   POST /api/proposals
 * @access  Private (Expert only)
 */
const createProposal = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can submit proposals.')
    err.statusCode = 403
    return next(err)
  }

  const { job_id, cover_letter, bid_amount, delivery_days } = req.body

  // Input Validation
  const errors = {}

  if (!job_id) {
    errors.job_id = 'Job ID is required'
  }

  let parsedBidAmount = null
  if (bid_amount === undefined || bid_amount === null || bid_amount === '') {
    errors.bid_amount = 'Bid amount is required'
  } else {
    parsedBidAmount = parseFloat(bid_amount)
    if (isNaN(parsedBidAmount) || parsedBidAmount <= 0) {
      errors.bid_amount = 'Bid amount must be a positive number'
    }
  }

  let parsedDeliveryDays = null
  if (delivery_days === undefined || delivery_days === null || delivery_days === '') {
    errors.delivery_days = 'Delivery days is required'
  } else {
    parsedDeliveryDays = parseInt(delivery_days, 10)
    if (isNaN(parsedDeliveryDays) || parsedDeliveryDays <= 0) {
      errors.delivery_days = 'Delivery days must be a positive integer'
    }
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  try {
    // 1. Verify that the job post exists and is open
    const jobCheck = await pool.query('SELECT status FROM job_posts WHERE id = $1', [job_id])
    if (jobCheck.rows.length === 0) {
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }

    if (jobCheck.rows[0].status !== 'open') {
      const err = new Error('Cannot submit proposal: Job post is not open')
      err.statusCode = 400
      return next(err)
    }

    // 2. Ensure an expert profile exists for referential integrity
    const expertProfileCheck = await pool.query('SELECT 1 FROM expert_profiles WHERE id = $1', [userId])
    if (expertProfileCheck.rows.length === 0) {
      await pool.query('INSERT INTO expert_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [userId])
    }

    // 3. Check if the expert has already submitted a proposal for this job
    const duplicateCheck = await pool.query(
      'SELECT id FROM proposals WHERE expert_id = $1 AND job_id = $2',
      [userId, job_id]
    )
    if (duplicateCheck.rows.length > 0) {
      const err = new Error('You have already submitted a proposal for this job')
      err.statusCode = 400
      return next(err)
    }

    // 4. Insert proposal
    const insertQuery = `
      INSERT INTO proposals (expert_id, job_id, cover_letter, bid_amount, delivery_days, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *;
    `
    const values = [
      userId,
      job_id,
      cover_letter ? cover_letter.trim() : null,
      parsedBidAmount,
      parsedDeliveryDays
    ]

    const result = await pool.query(insertQuery, values)

    // Trigger Notification
    try {
      const jobInfo = await pool.query('SELECT title, client_id FROM job_posts WHERE id = $1', [job_id]);
      const expertInfo = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
      if (jobInfo.rows.length > 0) {
        const jobTitle = jobInfo.rows[0].title;
        const clientId = jobInfo.rows[0].client_id;
        const expertName = expertInfo.rows[0]?.full_name || 'An expert';

        await sendNotification(clientId, {
          title: "New Proposal Received",
          message: `Expert ${expertName} has submitted a new proposal for your job "${jobTitle}".`,
          type: "new_proposal",
          referenceId: result.rows[0].id
        });
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] new_proposal:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Proposal submitted successfully',
      proposal: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get proposals for a job post
 * @route   GET /api/proposals/job/:jobId
 * @access  Private
 */
const getProposalsByJob = async (req, res, next) => {
  const { jobId } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  try {
    // Check if job exists
    const jobCheck = await pool.query('SELECT client_id FROM job_posts WHERE id = $1', [jobId])
    if (jobCheck.rows.length === 0) {
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }

    const jobOwnerId = jobCheck.rows[0].client_id

    // If client, verify they own the job or are admin
    if (userRole === 'client') {
      if (jobOwnerId !== userId && userRole !== 'admin') {
        const err = new Error('Forbidden: You can only view proposals for jobs you posted.')
        err.statusCode = 403
        return next(err)
      }

      // Return all proposals for the job
      const query = `
        SELECT p.*, u.full_name as expert_name, u.email as expert_email, ep.professional_title
        FROM proposals p
        JOIN users u ON p.expert_id = u.id
        LEFT JOIN expert_profiles ep ON p.expert_id = ep.id
        WHERE p.job_id = $1;
      `
      const result = await pool.query(query, [jobId])
      return res.status(200).json({
        success: true,
        proposals: result.rows
      })
    }

    // If expert, only return their own proposal for this job
    if (userRole === 'expert' || userRole === 'admin') {
      const query = `
        SELECT p.*, u.full_name as expert_name, u.email as expert_email, ep.professional_title
        FROM proposals p
        JOIN users u ON p.expert_id = u.id
        LEFT JOIN expert_profiles ep ON p.expert_id = ep.id
        WHERE p.job_id = $1 AND p.expert_id = $2;
      `
      const result = await pool.query(query, [jobId, userId])
      return res.status(200).json({
        success: true,
        proposals: result.rows
      })
    }

    const err = new Error('Unauthorized role')
    err.statusCode = 401
    return next(err)
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get a single proposal by ID
 * @route   GET /api/proposals/:id
 * @access  Private (expert who owns it OR client who owns the job)
 */
const getProposalById = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const query = `
      SELECT
        p.*,
        j.title        AS job_title,
        j.description  AS job_description,
        j.status       AS job_status,
        j.budget_min,
        j.budget_max,
        j.duration_days,
        j.client_id,
        u_expert.full_name AS expert_name,
        u_client.full_name AS client_name,
        ep.professional_title
      FROM proposals p
      JOIN job_posts     j        ON p.job_id    = j.id
      JOIN users         u_expert ON p.expert_id = u_expert.id
      JOIN users         u_client ON j.client_id = u_client.id
      LEFT JOIN expert_profiles ep ON p.expert_id = ep.id
      WHERE p.id = $1;
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      const err = new Error('Proposal not found');
      err.statusCode = 404;
      return next(err);
    }

    const proposal = result.rows[0];

    // Access control: only the expert who submitted it, the client who owns the job, or admin
    if (
      userRole !== 'admin' &&
      proposal.expert_id !== userId &&
      proposal.client_id !== userId
    ) {
      const err = new Error('Forbidden: You do not have access to this proposal');
      err.statusCode = 403;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      proposal
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Update a proposal
 * @route   PUT /api/proposals/:id
 * @access  Private (Owner expert only)
 */
const updateProposal = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  // if (userRole !== 'expert' && userRole !== 'admin') {
  //   const err = new Error('Forbidden: Only experts can update proposals.')
  //   err.statusCode = 403
  //   return next(err)
  // }

  const { cover_letter, bid_amount, delivery_days } = req.body

  // Validation — only validate fields that are provided
  const errors = {}
  const fieldsToUpdate = []
  const values = []
  let paramIndex = 1

  // Check cover_letter if provided
  if (cover_letter !== undefined) {
    fieldsToUpdate.push(`cover_letter = $${paramIndex++}`)
    values.push(cover_letter ? cover_letter.trim() : null)
  }

  // Check bid_amount if provided
  if (bid_amount !== undefined && bid_amount !== null && bid_amount !== '') {
    const parsedBidAmount = parseFloat(bid_amount)
    if (isNaN(parsedBidAmount) || parsedBidAmount <= 0) {
      errors.bid_amount = 'Bid amount must be a positive number'
    } else {
      fieldsToUpdate.push(`bid_amount = $${paramIndex++}`)
      values.push(parsedBidAmount)
    }
  }

  // Check delivery_days if provided
  if (delivery_days !== undefined && delivery_days !== null && delivery_days !== '') {
    const parsedDeliveryDays = parseInt(delivery_days, 10)
    if (isNaN(parsedDeliveryDays) || parsedDeliveryDays <= 0) {
      errors.delivery_days = 'Delivery days must be a positive integer'
    } else {
      fieldsToUpdate.push(`delivery_days = $${paramIndex++}`)
      values.push(parsedDeliveryDays)
    }
  }

  // Return validation errors if any
  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  // Require at least one field to update
  if (fieldsToUpdate.length === 0) {
    const err = new Error('At least one field (cover_letter, bid_amount, or delivery_days) must be provided to update')
    err.statusCode = 400
    return next(err)
  }

  try {
    // Verify ownership
    const proposalCheck = await pool.query('SELECT expert_id FROM proposals WHERE id = $1', [id])
    if (proposalCheck.rows.length === 0) {
      const err = new Error('Proposal not found')
      err.statusCode = 404
      return next(err)
    }

    if (proposalCheck.rows[0].expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only update your own proposal')
      err.statusCode = 403
      return next(err)
    }

    // Dynamically build UPDATE query with only the provided fields
    values.push(id)
    const updateQuery = `
      UPDATE proposals
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *;
    `

    const result = await pool.query(updateQuery, values)
    return res.status(200).json({
      success: true,
      message: 'Proposal updated successfully',
      proposal: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Delete a proposal
 * @route   DELETE /api/proposals/:id
 * @access  Private (Owner expert only)
 */
const deleteProposal = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const userRole = req.user.role

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can delete proposals.')
    err.statusCode = 403
    return next(err)
  }

  try {
    // Verify ownership
    const proposalCheck = await pool.query('SELECT expert_id FROM proposals WHERE id = $1', [id])
    if (proposalCheck.rows.length === 0) {
      const err = new Error('Proposal not found')
      err.statusCode = 404
      return next(err)
    }

    if (proposalCheck.rows[0].expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only delete your own proposal')
      err.statusCode = 403
      return next(err)
    }

    // Delete
    await pool.query('DELETE FROM proposals WHERE id = $1', [id])

    return res.status(200).json({
      success: true,
      message: 'Proposal deleted successfully'
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Update a proposal's status (Accept / Reject) — works for both client and expert
 * @route   PUT /api/proposals/:id/status
 * @access  Private
 */
const updateProposalStatus = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  let { status, start_project } = req.body;

  if (!status) {
    const err = new Error('Status is required');
    err.statusCode = 400;
    return next(err);
  }

  // Normalize approved -> accepted
  if (status === 'approved') {
    status = 'accepted';
  }

  if (status !== 'accepted' && status !== 'rejected') {
    const err = new Error('Invalid status. Status must be one of: accepted, approved, rejected');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // 1. Fetch proposal and join with job post to verify ownership
    const proposalQuery = `
      SELECT p.*, j.client_id, j.status as job_status, j.title as job_title, j.description as job_description
      FROM proposals p
      JOIN job_posts j ON p.job_id = j.id
      WHERE p.id = $1
    `;
    const proposalRes = await pool.query(proposalQuery, [id]);

    if (proposalRes.rows.length === 0) {
      const err = new Error('Proposal not found');
      err.statusCode = 404;
      return next(err);
    }

    const proposal = proposalRes.rows[0];

    const isClient = userRole === 'client' && proposal.client_id === userId;
    const isExpert = userRole === 'expert' && proposal.expert_id === userId;

    // Expert can only approve/reject when the counter was initiated by the client (it's their turn)
    if (isExpert) {
      if (proposal.status !== 'countered' || proposal.counter_initiated_by === userId) {
        const err = new Error('Forbidden: You can only respond to a counter-proposal made by the client');
        err.statusCode = 403;
        return next(err);
      }
    } else if (!isClient && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only update proposals for your own job posts');
      err.statusCode = 403;
      return next(err);
    }

    // 1.5 Check if another proposal has already been accepted or if the job is closed/filled
    if (status === 'accepted') {
      const acceptedCheck = await pool.query(
        "SELECT id FROM proposals WHERE job_id = $1 AND status = 'accepted' AND id <> $2",
        [proposal.job_id, id]
      );
      if (acceptedCheck.rows.length > 0) {
        const err = new Error('Cannot accept proposal: Another proposal has already been accepted for this job.');
        err.statusCode = 400;
        return next(err);
      }
      if (proposal.job_status === 'closed') {
        const err = new Error('Cannot accept proposal: The job post is already closed/filled.');
        err.statusCode = 400;
        return next(err);
      }
    }

    // 2. Start transaction
    await pool.query('BEGIN');

    // 3. If approving a counter, adopt the counter_bid_amount as the final bid
    let finalBidAmount = proposal.bid_amount;
    if (status === 'accepted' && proposal.status === 'countered' && proposal.counter_bid_amount) {
      finalBidAmount = proposal.counter_bid_amount;
    }

    // 4. Update the proposal status
    const updateProposalQuery = `
      UPDATE proposals
      SET status = $1, bid_amount = $2
      WHERE id = $3
      RETURNING *;
    `;
    const updatedProposalRes = await pool.query(updateProposalQuery, [status, finalBidAmount, id]);
    const updatedProposal = updatedProposalRes.rows[0];

    let createdProject = null;

    // Acceptance confirms terms only; funding and project creation are separate.
    if (status === 'accepted') {
      await pool.query("UPDATE job_posts SET status = 'pending' WHERE id = $1", [proposal.job_id]);
    }

    await pool.query('COMMIT');

    // Trigger Notifications
    try {
      if (status === 'accepted') {
        // 1. Notify Expert that their proposal was accepted
        await sendNotification(proposal.expert_id, {
          title: "Proposal Accepted",
          message: `Your proposal for the job "${proposal.job_title}" has been accepted.`,
          type: "proposal_accepted",
          referenceId: proposal.id
        });

        // 2. Notify both Client and Expert about the new project
        if (createdProject) {
          await sendNotification(proposal.client_id, {
            title: "New Project Started",
            message: `A new project for "${proposal.job_title}" has been initiated.`,
            type: "new_project",
            referenceId: createdProject.id
          });

          await sendNotification(proposal.expert_id, {
            title: "New Project Started",
            message: `A new project for "${proposal.job_title}" has been initiated.`,
            type: "new_project",
            referenceId: createdProject.id
          });
        }
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] updateProposalStatus:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Proposal status updated to ${status} successfully.`,
      proposal: updatedProposal,
      project: createdProject
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    return next(error);
  }
};

/**
 * @desc    Counter a proposal with a new bid amount (client -> expert or expert -> client)
 * @route   PUT /api/proposals/:id/counter
 * @access  Private (Client who owns the job OR Expert who owns the proposal)
 */
const counterProposal = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { bid_amount, cover_letter } = req.body;

  // Validate bid_amount
  const parsedBidAmount = parseFloat(bid_amount);
  if (!bid_amount || isNaN(parsedBidAmount) || parsedBidAmount <= 0) {
    const err = new Error('A valid bid amount is required for a counter-proposal');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // Fetch proposal + job ownership info
    const proposalQuery = `
      SELECT p.*, j.client_id, j.status as job_status
      FROM proposals p
      JOIN job_posts j ON p.job_id = j.id
      WHERE p.id = $1
    `;
    const proposalRes = await pool.query(proposalQuery, [id]);
    if (proposalRes.rows.length === 0) {
      const err = new Error('Proposal not found');
      err.statusCode = 404;
      return next(err);
    }
    const proposal = proposalRes.rows[0];

    // Only the client who owns the job OR the expert who submitted the proposal can counter
    const isClient = userRole === 'client' && proposal.client_id === userId;
    const isExpert = userRole === 'expert' && proposal.expert_id === userId;
    if (!isClient && !isExpert && userRole !== 'admin') {
      const err = new Error('Forbidden: You are not a party to this proposal');
      err.statusCode = 403;
      return next(err);
    }

    // Cannot counter an already accepted or rejected proposal
    if (proposal.status === 'accepted' || proposal.status === 'rejected') {
      const err = new Error(`Cannot counter a proposal that is already ${proposal.status}`);
      err.statusCode = 400;
      return next(err);
    }

    // Prevent countering your own counter (must wait for the other party)
    if (proposal.status === 'countered' && proposal.counter_initiated_by === userId) {
      const err = new Error('You already sent a counter-proposal. Wait for the other party to respond.');
      err.statusCode = 400;
      return next(err);
    }

    // Update proposal with counter fields
    const updateQuery = `
      UPDATE proposals
      SET
        status = 'countered',
        counter_bid_amount = $1,
        counter_cover_letter = $2,
        counter_initiated_by = $3
      WHERE id = $4
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [
      parsedBidAmount,
      cover_letter ? cover_letter.trim() : null,
      userId,
      id
    ]);

    // Trigger Notification
    try {
      const initiatorRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
      const initiatorName = initiatorRes.rows[0]?.full_name || 'Someone';

      const jobRes = await pool.query('SELECT title FROM job_posts WHERE id = $1', [proposal.job_id]);
      const jobTitle = jobRes.rows[0]?.title || 'your job';

      const recipientId = isClient ? proposal.expert_id : proposal.client_id;
      const messageText = isClient 
        ? `Client ${initiatorName} has sent a counter-proposal for "${jobTitle}"`
        : `Expert ${initiatorName} has send a counter-proposal for "${jobTitle}"`;

      await sendNotification(recipientId, {
        title: "New Counter Proposal",
        message: messageText,
        type: "counter_proposal",
        referenceId: result.rows[0].id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] counterProposal:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Counter-proposal submitted successfully',
      proposal: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get all proposals submitted by the authenticated expert
 * @route   GET /api/proposals/my
 * @access  Private (Expert only)
 */
const getMyProposals = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can access their proposals.');
    err.statusCode = 403;
    return next(err);
  }

  try {
    const query = `
      SELECT
        p.*,
        j.title        AS job_title,
        j.description  AS job_description,
        j.status       AS job_status,
        j.budget_min,
        j.budget_max,
        j.duration_days,
        u.full_name    AS client_name
      FROM proposals p
      JOIN job_posts  j ON p.job_id    = j.id
      JOIN users      u ON j.client_id = u.id
      WHERE p.expert_id = $1
      ORDER BY p.id DESC;
    `;

    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      proposals: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createProposal,
  getMyProposals,
  getProposalsByJob,
  getProposalById,
  updateProposal,
  deleteProposal,
  updateProposalStatus,
  counterProposal
}
