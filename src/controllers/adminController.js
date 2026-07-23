const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

// Helper to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * @desc    Get all content (job posts and services) with optional status/type filtering
 * @route   GET /api/admin/content
 * @access  Private (Admin)
 */
const getAllContent = async (req, res, next) => {
  const { type = 'all', status = 'all' } = req.query;

  try {
    let jobs = [];
    let services = [];

    // Query Job Posts
    if (type === 'all' || type === 'job') {
      let jobQuery = `
        SELECT j.*, c.company_name, u.full_name as client_name
        FROM job_posts j
        LEFT JOIN client_profiles c ON j.client_id = c.id
        LEFT JOIN users u ON c.id = u.id
        WHERE 1=1
      `;
      const params = [];
      if (status !== 'all') {
        params.push(status);
        jobQuery += ` AND j.status = $${params.length}`;
      }
      jobQuery += ' ORDER BY j.id DESC';
      const jobRes = await pool.query(jobQuery, params);
      jobs = jobRes.rows;
    }

    // Query Services
    if (type === 'all' || type === 'service') {
      let serviceQuery = `
        SELECT s.*, e.professional_title, u.full_name as expert_name
        FROM services s
        LEFT JOIN expert_profiles e ON s.expert_id = e.id
        LEFT JOIN users u ON e.id = u.id
        WHERE 1=1
      `;
      const params = [];
      if (status !== 'all') {
        params.push(status);
        serviceQuery += ` AND s.status = $${params.length}`;
      }
      serviceQuery += ' ORDER BY s.id DESC';
      const serviceRes = await pool.query(serviceQuery, params);
      services = serviceRes.rows;
    }

    // Combine content list for dashboard widgets
    const combined = [
      ...jobs.map(j => ({ ...j, contentType: 'job' })),
      ...services.map(s => ({ ...s, contentType: 'service' }))
    ].sort((a, b) => b.id - a.id); // Sorted descending

    return res.status(200).json({
      success: true,
      jobs,
      services,
      combined
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Approve, reject or remove content (job or service)
 * @route   PUT /api/admin/content/:contentType/:id/status
 * @access  Private (Admin)
 */
const setContentStatus = async (req, res, next) => {
  const { contentType, id } = req.params;
  const { status } = req.body;

  const validStatuses = ['open', 'approved', 'rejected', 'removed', 'pending'];
  if (!status || !validStatuses.includes(status)) {
    const err = new Error('Invalid status value');
    err.statusCode = 400;
    return next(err);
  }

  try {
    if (contentType === 'job') {
      // Map 'approved' to 'open' for jobs
      const dbStatus = status === 'approved' ? 'open' : status;
      const updateQuery = `
        UPDATE job_posts 
        SET status = $1 
        WHERE id = $2 
        RETURNING *;
      `;
      const jobRes = await pool.query(updateQuery, [dbStatus, id]);
      if (jobRes.rows.length === 0) {
        const err = new Error('Job post not found');
        err.statusCode = 404;
        return next(err);
      }
      return res.status(200).json({
        success: true,
        message: `Job post status updated to ${dbStatus}`,
        content: jobRes.rows[0]
      });

    } else if (contentType === 'service') {
      // Map 'open' to 'approved' for services
      const dbStatus = status === 'open' ? 'approved' : status;
      const updateQuery = `
        UPDATE services 
        SET status = $1 
        WHERE id = $2 
        RETURNING *;
      `;
      const serviceRes = await pool.query(updateQuery, [dbStatus, id]);
      if (serviceRes.rows.length === 0) {
        const err = new Error('Service not found');
        err.statusCode = 404;
        return next(err);
      }
      return res.status(200).json({
        success: true,
        message: `Service status updated to ${dbStatus}`,
        content: serviceRes.rows[0]
      });

    } else {
      const err = new Error('Invalid content type. Must be job or service.');
      err.statusCode = 400;
      return next(err);
    }

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get all users list (with creation date and status)
 * @route   GET /api/admin/users
 * @access  Private (Admin)
 */
const getUsers = async (req, res, next) => {
  try {
    const usersQuery = `
      SELECT id, full_name, email, role, is_verified, created_at, acc_status, avatar_url
      FROM users 
      ORDER BY created_at DESC, id DESC;
    `;
    const usersRes = await pool.query(usersQuery);

    return res.status(200).json({
      success: true,
      count: usersRes.rows.length,
      users: usersRes.rows
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get a single user by ID
 * @route   GET /api/admin/users/:id
 * @access  Private (Admin)
 */
const getUserById = async (req, res, next) => {
  const { id } = req.params;

  try {
    const userQuery = `
      SELECT id, full_name, email, role, is_verified, created_at, acc_status, avatar_url
      FROM users 
      WHERE id = $1;
    `;
    const userRes = await pool.query(userQuery, [id]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const user = userRes.rows[0];
    let profile = null;

    if (user.role === 'client') {
      const clientRes = await pool.query('SELECT * FROM client_profiles WHERE id = $1', [id]);
      profile = clientRes.rows[0] || null;
    } else if (user.role === 'expert') {
      const expertRes = await pool.query('SELECT * FROM expert_profiles WHERE id = $1', [id]);
      profile = expertRes.rows[0] || null;
    }

    return res.status(200).json({
      success: true,
      user,
      profile
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Create a new user (with profile automatically setup)
 * @route   POST /api/admin/users
 * @access  Private (Admin)
 */
const createUser = async (req, res, next) => {
  const { fullName, email, role, password } = req.body;

  if (!fullName || !email || !role || !password) {
    const err = new Error('fullName, email, role, and password are required');
    err.statusCode = 400;
    return next(err);
  }

  if (!isValidEmail(email)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  if (password.length < 6) {
    const err = new Error('Password must be at least 6 characters long');
    err.statusCode = 400;
    return next(err);
  }

  const validRoles = ['client', 'expert', 'admin'];
  if (!validRoles.includes(role)) {
    const err = new Error('Role must be one of: client, expert, admin');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const dbClient = await pool.connect();

  try {
    // Check if email already exists
    const checkUserRes = await dbClient.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (checkUserRes.rows.length > 0) {
      const err = new Error('Email is already registered');
      err.statusCode = 400;
      return next(err);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await dbClient.query('BEGIN');

    const insertUserQuery = `
      INSERT INTO users (full_name, email, role, password, is_verified, acc_status)
      VALUES ($1, $2, $3, $4, true, true)
      RETURNING id, full_name, email, role, is_verified, created_at, acc_status;
    `;
    const userRes = await dbClient.query(insertUserQuery, [
      fullName.trim(),
      normalizedEmail,
      role,
      hashedPassword
    ]);

    const newUser = userRes.rows[0];

    // Setup matching profile
    if (role === 'client') {
      await dbClient.query('INSERT INTO client_profiles (id) VALUES ($1)', [newUser.id]);
    } else if (role === 'expert') {
      await dbClient.query('INSERT INTO expert_profiles (id) VALUES ($1)', [newUser.id]);
    }

    await dbClient.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'User created successfully by administrator',
      user: newUser
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Update a user
 * @route   PUT /api/admin/users/:id
 * @access  Private (Admin)
 */
const updateUser = async (req, res, next) => {
  const { id } = req.params;
  const { fullName, email, role, acc_status } = req.body;

  if (!fullName || !email || !role) {
    const err = new Error('fullName, email, and role are required');
    err.statusCode = 400;
    return next(err);
  }

  if (!isValidEmail(email)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  const validRoles = ['client', 'expert', 'admin'];
  if (!validRoles.includes(role)) {
    const err = new Error('Role must be one of: client, expert, admin');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const dbClient = await pool.connect();

  try {
    // Check if email is taken by another user
    const checkEmailRes = await dbClient.query('SELECT id FROM users WHERE email = $1 AND id != $2', [normalizedEmail, id]);
    if (checkEmailRes.rows.length > 0) {
      const err = new Error('Email is already in use by another user');
      err.statusCode = 400;
      return next(err);
    }

    await dbClient.query('BEGIN');

    // Get current user role
    const oldRoleRes = await dbClient.query('SELECT role FROM users WHERE id = $1', [id]);
    if (oldRoleRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }
    const oldRole = oldRoleRes.rows[0].role;

    const accStatus = acc_status !== undefined ? acc_status : true;

    const updateQuery = `
      UPDATE users 
      SET full_name = $1, email = $2, role = $3, acc_status = $4
      WHERE id = $5
      RETURNING id, full_name, email, role, is_verified, created_at, acc_status;
    `;
    const userRes = await dbClient.query(updateQuery, [
      fullName.trim(),
      normalizedEmail,
      role,
      accStatus,
      id
    ]);

    const updatedUser = userRes.rows[0];

    // If role changed, ensure new profile is created
    if (role !== oldRole) {
      if (role === 'client') {
        const profileCheck = await dbClient.query('SELECT id FROM client_profiles WHERE id = $1', [id]);
        if (profileCheck.rows.length === 0) {
          await dbClient.query('INSERT INTO client_profiles (id) VALUES ($1)', [id]);
        }
      } else if (role === 'expert') {
        const profileCheck = await dbClient.query('SELECT id FROM expert_profiles WHERE id = $1', [id]);
        if (profileCheck.rows.length === 0) {
          await dbClient.query('INSERT INTO expert_profiles (id) VALUES ($1)', [id]);
        }
      }
    }

    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: updatedUser
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Delete a user
 * @route   DELETE /api/admin/users/:id
 * @access  Private (Admin)
 */
const deleteUser = async (req, res, next) => {
  const { id } = req.params;

  try {
    const deleteQuery = 'DELETE FROM users WHERE id = $1 RETURNING id, full_name, email;';
    const deleteRes = await pool.query(deleteQuery, [id]);

    if (deleteRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      deletedUser: deleteRes.rows[0]
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Deactivate or Activate user (Ban/Unban)
 * @route   PATCH /api/admin/users/:id/status
 * @access  Private (Admin)
 */
const deactivateUser = async (req, res, next) => {
  const { id } = req.params;
  const { acc_status } = req.body;

  if (acc_status === undefined || typeof acc_status !== 'boolean') {
    const err = new Error('acc_status (boolean) is required in request body');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const updateQuery = `
      UPDATE users 
      SET acc_status = $1 
      WHERE id = $2 
      RETURNING id, full_name, email, role, acc_status;
    `;
    const userRes = await pool.query(updateQuery, [acc_status, id]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      message: acc_status ? 'User account activated successfully' : 'User account deactivated (banned) successfully',
      user: userRes.rows[0]
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get all disputes / projects with dispute status
 * @route   GET /api/admin/disputes
 * @access  Private (Admin)
 */
const getDisputes = async (req, res, next) => {
  try {
    const query = `
      SELECT p.*, 
        c.full_name as client_name, c.email as client_email,
        e.full_name as expert_name, e.email as expert_email
      FROM projects p
      LEFT JOIN users c ON p.client_id = c.id
      LEFT JOIN users e ON p.expert_id = e.id
      ORDER BY p.id DESC;
    `;
    const result = await pool.query(query);
    return res.status(200).json({
      success: true,
      disputes: result.rows
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Resolve a dispute (refund client or release funds to expert)
 * @route   POST /api/admin/disputes/:id/resolve
 * @access  Private (Admin)
 */
const resolveDispute = async (req, res, next) => {
  const { id } = req.params;
  const { resolution } = req.body; // 'refund_client' or 'release_expert'

  if (!['refund_client', 'release_expert'].includes(resolution)) {
    const err = new Error("Invalid resolution. Must be 'refund_client' or 'release_expert'");
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const projectRes = await dbClient.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const project = projectRes.rows[0];
    const newStatus = resolution === 'refund_client' ? 'terminated' : 'completed';

    await dbClient.query('UPDATE projects SET status = $1 WHERE id = $2', [newStatus, id]);

    const refundAmount = parseFloat(project.total_amount || 0);

    if (resolution === 'refund_client') {
      await dbClient.query(
        `UPDATE client_profiles SET budget = budget + $1 WHERE id = $2;`,
        [refundAmount, project.client_id]
      );
      await dbClient.query(
        `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, complete_at)
         VALUES ($1, $1, $2, 'refund', 'completed', CURRENT_TIMESTAMP);`,
        [project.client_id, refundAmount]
      );
    } else {
      await dbClient.query(
        `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, complete_at)
         VALUES ($1, $2, $3, 'escrow_release', 'completed', CURRENT_TIMESTAMP);`,
        [project.client_id, project.expert_id, refundAmount]
      );
    }

    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `Dispute resolved successfully (${resolution})`,
      projectStatus: newStatus
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

module.exports = {
  getAllContent,
  setContentStatus,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  deactivateUser,
  getDisputes,
  resolveDispute
};
