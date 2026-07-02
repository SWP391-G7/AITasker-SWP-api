const { pool } = require('../config/db')

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

    // 5. If status is accepted, handle job status and project creation
    if (status === 'accepted') {
      if (start_project === false || isExpert) {
        // Expert approving → job goes to pending; client must click Create Project
        const updateJobQuery = `
          UPDATE job_posts
          SET status = 'pending'
          WHERE id = $1;
        `;
        await pool.query(updateJobQuery, [proposal.job_id]);
      } else {
        // Client accepting with immediate start → close job and auto-create project
        const updateJobQuery = `
          UPDATE job_posts
          SET status = 'closed'
          WHERE id = $1;
        `;
        await pool.query(updateJobQuery, [proposal.job_id]);

        // Auto create project
        const insertProjectQuery = `
          INSERT INTO projects (expert_id, client_id, type, status, total_amount, title, description)
          VALUES ($1, $2, 'fixed_milestone', 'active', $3, $4, $5)
          RETURNING *;
        `;
        const projectRes = await pool.query(insertProjectQuery, [
          proposal.expert_id,
          proposal.client_id,
          finalBidAmount,
          proposal.job_title,
          proposal.job_description
        ]);
        createdProject = projectRes.rows[0];
      }
    }

    await pool.query('COMMIT');

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

    return res.status(200).json({
      success: true,
      message: 'Counter-proposal submitted successfully',
      proposal: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createProposal,
  getProposalsByJob,
  updateProposal,
  deleteProposal,
  updateProposalStatus,
  counterProposal
}
