const { pool } = require('../config/db')

/**
 * @desc    Create a new job post
 * @route   POST /api/jobs
 * @access  Private
 */
const createJobPost = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  // 1. Enforce that only clients (or admins) can post jobs
  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can post jobs.')
    err.statusCode = 403
    return next(err)
  }

  const {
    title,
    description,
    requirements,
    budgetMin,
    budgetMax,
    requiredSkill,
    tags,
    durationDays,
    images,
    videoLink
  } = req.body

  // 2. Input Validation
  const errors = {}

  if (!title || typeof title !== 'string' || title.trim() === '') {
    errors.title = 'Job title is required'
  } else if (title.length > 255) {
    errors.title = 'Job title cannot exceed 255 characters'
  }

  if (description && typeof description !== 'string') {
    errors.description = 'Description must be a string'
  }

  if (requirements && typeof requirements !== 'string') {
    errors.requirements = 'Requirements must be a string'
  }

  let parsedBudgetMin = null
  if (budgetMin !== undefined && budgetMin !== null && budgetMin !== '') {
    parsedBudgetMin = parseFloat(budgetMin)
    if (isNaN(parsedBudgetMin) || parsedBudgetMin < 0) {
      errors.budgetMin = 'Minimum budget must be a non-negative number'
    }
  }

  let parsedBudgetMax = null
  if (budgetMax !== undefined && budgetMax !== null && budgetMax !== '') {
    parsedBudgetMax = parseFloat(budgetMax)
    if (isNaN(parsedBudgetMax) || parsedBudgetMax < 0) {
      errors.budgetMax = 'Maximum budget must be a non-negative number'
    }
  }

  if (parsedBudgetMin !== null && parsedBudgetMax !== null && parsedBudgetMax < parsedBudgetMin) {
    errors.budgetMax = 'Maximum budget cannot be less than minimum budget'
  }

  let parsedDurationDays = null
  if (durationDays !== undefined && durationDays !== null && durationDays !== '') {
    parsedDurationDays = parseInt(durationDays, 10)
    if (isNaN(parsedDurationDays) || parsedDurationDays <= 0) {
      errors.durationDays = 'Duration must be a positive number of days'
    }
  }

  if (requiredSkill && requiredSkill.length > 255) {
    errors.requiredSkill = 'Required skill cannot exceed 255 characters'
  }

  if (tags && tags.length > 500) {
    errors.tags = 'Tags cannot exceed 500 characters'
  }

  if (images && typeof images !== 'string') {
    errors.images = 'Images must be a JSON string'
  }

  if (videoLink && typeof videoLink !== 'string') {
    errors.videoLink = 'Video link must be a string'
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  try {
    // 3. Ensure a client profile exists for the user (to avoid foreign key constraint violations)
    const clientProfileCheck = await pool.query('SELECT 1 FROM client_profiles WHERE id = $1', [userId])
    if (clientProfileCheck.rows.length === 0) {
      await pool.query('INSERT INTO client_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [userId])
    }

    // 4. Insert Job Post
    const insertQuery = `
      INSERT INTO job_posts (
        client_id,
        title,
        description,
        requirements,
        budget_min,
        budget_max,
        required_skill,
        tags,
        images,
        video_link,
        duration_days
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `

    const values = [
      userId,
      title.trim(),
      description ? description.trim() : null,
      requirements ? requirements.trim() : null,
      parsedBudgetMin,
      parsedBudgetMax,
      requiredSkill ? requiredSkill.trim() : null,
      tags || null,
      images || null,
      videoLink || null,
      parsedDurationDays
    ]

    const result = await pool.query(insertQuery, values)

    return res.status(201).json({
      success: true,
      message: 'Job post created successfully',
      jobPost: result.rows[0]
    })

  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get all job posts by the current user
 * @route   GET /api/jobs/my
 * @access  Private
 */
const getMyJobs = async (req, res, next) => {
  const userId = req.user.id

  try {
    const query = `
      SELECT * FROM job_posts
      WHERE client_id = $1
      ORDER BY id DESC;
    `

    const result = await pool.query(query, [userId])

    return res.status(200).json({
      success: true,
      jobPosts: result.rows,
      data: result.rows
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get a single job post by ID
 * @route   GET /api/jobs/:id
 * @access  Private
 */
const getJobById = async (req, res, next) => {
  const { id } = req.params

  try {
    const query = `
      SELECT j.*, c.company_name, c.budget as client_budget, u.full_name as client_name, u.avatar_url as client_avatar
      FROM job_posts j
      LEFT JOIN users u ON j.client_id = u.id
      LEFT JOIN client_profiles c ON u.id = c.id
      WHERE j.id = $1;
    `

    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }

    const jobPost = result.rows[0]
    // If the job is pending, only the owner and admin can see the pending status.
    if (jobPost.status === 'pending' && (!req.user || (jobPost.client_id !== req.user.id && req.user.role !== 'admin'))) {
      jobPost.status = 'closed';
    }

    return res.status(200).json({
      success: true,
      jobPost: jobPost,
      data: jobPost
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Update a job post
 * @route   PUT /api/jobs/:id
 * @access  Private
 */
const updateJobPost = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const { title, description, requirements, budgetMin, budgetMax, requiredSkill, tags, durationDays, images, videoLink } = req.body

  try {
    // Check if job exists and belongs to current user
    const jobCheck = await pool.query('SELECT * FROM job_posts WHERE id = $1', [id])

    if (jobCheck.rows.length === 0) {
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }

    const userRole = req.user.role
    if (jobCheck.rows[0].client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only update your own job posts')
      err.statusCode = 403
      return next(err)
    }

    // Validate fields before updating
    const errors = {}

    if (title !== undefined && (!title || typeof title !== 'string' || title.trim() === '')) {
      errors.title = 'Job title is required'
    } else if (title !== undefined && title.length > 255) {
      errors.title = 'Job title cannot exceed 255 characters'
    }

    if (description !== undefined && typeof description !== 'string') {
      errors.description = 'Description must be a string'
    }

    if (requirements !== undefined && typeof requirements !== 'string') {
      errors.requirements = 'Requirements must be a string'
    }

    if (budgetMin !== undefined) {
      const parsedMin = parseFloat(budgetMin)
      if (isNaN(parsedMin) || parsedMin < 0) {
        errors.budgetMin = 'Minimum budget must be a non-negative number'
      }
    }

    if (budgetMax !== undefined) {
      const parsedMax = parseFloat(budgetMax)
      if (isNaN(parsedMax) || parsedMax < 0) {
        errors.budgetMax = 'Maximum budget must be a non-negative number'
      }
    }

    if (budgetMin !== undefined && budgetMax !== undefined) {
      const parsedMin = parseFloat(budgetMin)
      const parsedMax = parseFloat(budgetMax)
      if (!isNaN(parsedMin) && !isNaN(parsedMax) && parsedMax < parsedMin) {
        errors.budgetMax = 'Maximum budget cannot be less than minimum budget'
      }
    }

    if (durationDays !== undefined) {
      const parsedDur = parseInt(durationDays, 10)
      if (isNaN(parsedDur) || parsedDur <= 0) {
        errors.durationDays = 'Duration must be a positive number of days'
      }
    }

    if (requiredSkill !== undefined && requiredSkill.length > 255) {
      errors.requiredSkill = 'Required skill cannot exceed 255 characters'
    }

    if (tags !== undefined && tags.length > 500) {
      errors.tags = 'Tags cannot exceed 500 characters'
    }

    if (images !== undefined && typeof images !== 'string') {
      errors.images = 'Images must be a JSON string'
    }

    if (videoLink !== undefined && typeof videoLink !== 'string') {
      errors.videoLink = 'Video link must be a string'
    }

    if (Object.keys(errors).length > 0) {
      const err = new Error('Validation failed')
      err.statusCode = 400
      err.errors = errors
      return next(err)
    }

    // Build dynamic update query
    const updates = []
    const values = []
    let paramCount = 1

    if (title !== undefined) {
      updates.push(`title = $${paramCount}`)
      values.push(title)
      paramCount++
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`)
      values.push(description)
      paramCount++
    }

    if (requirements !== undefined) {
      updates.push(`requirements = $${paramCount}`)
      values.push(requirements)
      paramCount++
    }

    if (budgetMin !== undefined) {
      updates.push(`budget_min = $${paramCount}`)
      values.push(budgetMin)
      paramCount++
    }

    if (budgetMax !== undefined) {
      updates.push(`budget_max = $${paramCount}`)
      values.push(budgetMax)
      paramCount++
    }

    if (requiredSkill !== undefined) {
      updates.push(`required_skill = $${paramCount}`)
      values.push(requiredSkill)
      paramCount++
    }

    if (tags !== undefined) {
      updates.push(`tags = $${paramCount}`)
      values.push(tags)
      paramCount++
    }

    if (images !== undefined) {
      updates.push(`images = $${paramCount}`)
      values.push(images)
      paramCount++
    }

    if (videoLink !== undefined) {
      updates.push(`video_link = $${paramCount}`)
      values.push(videoLink)
      paramCount++
    }

    if (durationDays !== undefined) {
      updates.push(`duration_days = $${paramCount}`)
      values.push(durationDays)
      paramCount++
    }



    if (updates.length === 0) {
      const err = new Error('No fields to update')
      err.statusCode = 400
      return next(err)
    }

    values.push(id)

    const updateQuery = `
      UPDATE job_posts
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *;
    `

    const result = await pool.query(updateQuery, values)

    return res.status(200).json({
      success: true,
      message: 'Job post updated successfully',
      jobPost: result.rows[0],
      data: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Delete a job post
 * @route   DELETE /api/jobs/:id
 * @access  Private
 */
const deleteJobPost = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id

  try {
    // Check if job exists and belongs to current user
    const jobCheck = await pool.query('SELECT * FROM job_posts WHERE id = $1', [id])

    if (jobCheck.rows.length === 0) {
      const err = new Error('Job post not found')
      err.statusCode = 404
      return next(err)
    }

    const userRole = req.user.role
    if (jobCheck.rows[0].client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only delete your own job posts')
      err.statusCode = 403
      return next(err)
    }

    const deleteQuery = 'DELETE FROM job_posts WHERE id = $1 RETURNING *;'
    const result = await pool.query(deleteQuery, [id])

    return res.status(200).json({
      success: true,
      message: 'Job post deleted successfully',
      data: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

module.exports = {
  createJobPost,
  getMyJobs,
  getJobById,
  updateJobPost,
  deleteJobPost
}
