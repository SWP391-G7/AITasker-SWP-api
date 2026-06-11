const { pool } = require('../config/db');

/**
 * @desc    Create a new job post
 * @route   POST /api/jobs
 * @access  Private
 */
const createJobPost = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  // 1. Enforce that only clients (or admins) can post jobs
  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can post jobs.');
    err.statusCode = 403;
    return next(err);
  }

  const {
    title,
    description,
    budgetMin,
    budgetMax,
    requiredSkill,
    durationDays,
    deadline
  } = req.body;

  // 2. Input Validation
  const errors = {};

  if (!title || typeof title !== 'string' || title.trim() === '') {
    errors.title = 'Job title is required';
  } else if (title.length > 255) {
    errors.title = 'Job title cannot exceed 255 characters';
  }

  if (description && typeof description !== 'string') {
    errors.description = 'Description must be a string';
  }

  let parsedBudgetMin = null;
  if (budgetMin !== undefined && budgetMin !== null && budgetMin !== '') {
    parsedBudgetMin = parseFloat(budgetMin);
    if (isNaN(parsedBudgetMin) || parsedBudgetMin < 0) {
      errors.budgetMin = 'Minimum budget must be a non-negative number';
    }
  }

  let parsedBudgetMax = null;
  if (budgetMax !== undefined && budgetMax !== null && budgetMax !== '') {
    parsedBudgetMax = parseFloat(budgetMax);
    if (isNaN(parsedBudgetMax) || parsedBudgetMax < 0) {
      errors.budgetMax = 'Maximum budget must be a non-negative number';
    }
  }

  if (parsedBudgetMin !== null && parsedBudgetMax !== null && parsedBudgetMax < parsedBudgetMin) {
    errors.budgetMax = 'Maximum budget cannot be less than minimum budget';
  }

  let parsedDurationDays = null;
  if (durationDays !== undefined && durationDays !== null && durationDays !== '') {
    parsedDurationDays = parseInt(durationDays, 10);
    if (isNaN(parsedDurationDays) || parsedDurationDays <= 0) {
      errors.durationDays = 'Duration must be a positive number of days';
    }
  }

  if (requiredSkill && requiredSkill.length > 255) {
    errors.requiredSkill = 'Required skill cannot exceed 255 characters';
  }

  let parsedDeadline = null;
  if (deadline) {
    parsedDeadline = new Date(deadline);
    if (isNaN(parsedDeadline.getTime())) {
      errors.deadline = 'Invalid deadline date';
    } else if (parsedDeadline <= new Date()) {
      errors.deadline = 'Deadline must be a date in the future';
    }
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed');
    err.statusCode = 400;
    err.errors = errors;
    return next(err);
  }

  try {
    // 3. Ensure a client profile exists for the user (to avoid foreign key constraint violations)
    const clientProfileCheck = await pool.query('SELECT 1 FROM client_profiles WHERE id = $1', [userId]);
    if (clientProfileCheck.rows.length === 0) {
      await pool.query('INSERT INTO client_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [userId]);
    }

    // 4. Insert Job Post
    const insertQuery = `
      INSERT INTO job_posts (
        client_id,
        title,
        description,
        budget_min,
        budget_max,
        required_skill,
        duration_days,
        deadline
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `;

    const values = [
      userId,
      title.trim(),
      description ? description.trim() : null,
      parsedBudgetMin,
      parsedBudgetMax,
      requiredSkill ? requiredSkill.trim() : null,
      parsedDurationDays,
      parsedDeadline
    ];

    const result = await pool.query(insertQuery, values);

    return res.status(201).json({
      success: true,
      message: 'Job post created successfully',
      jobPost: result.rows[0]
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get all job posts by the current user
 * @route   GET /api/jobs/my
 * @access  Private
 */
const getMyJobs = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const query = `
      SELECT * FROM job_posts
      WHERE client_id = $1
      ORDER BY id DESC;
    `;

    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      jobPosts: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createJobPost,
  getMyJobs
};
