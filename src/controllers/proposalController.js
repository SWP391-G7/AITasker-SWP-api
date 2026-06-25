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

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can update proposals.')
    err.statusCode = 403
    return next(err)
  }

  const { cover_letter, bid_amount, delivery_days } = req.body

  // Validation
  const errors = {}

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

    // Update
    const updateQuery = `
      UPDATE proposals
      SET cover_letter = $1, bid_amount = $2, delivery_days = $3
      WHERE id = $4
      RETURNING *;
    `
    const values = [
      cover_letter ? cover_letter.trim() : null,
      parsedBidAmount,
      parsedDeliveryDays,
      id
    ]

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

module.exports = {
  createProposal,
  getProposalsByJob,
  updateProposal,
  deleteProposal
}
