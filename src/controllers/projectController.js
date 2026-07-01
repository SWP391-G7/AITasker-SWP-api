const { pool } = require('../config/db');

const validTypes = ['fixed_milestone', 'hourly_contract'];
const validStatuses = ['active', 'completed', 'disputed', 'terminated'];

/**
 * @desc    Create a new project
 * @route   POST /api/projects
 * @access  Private
 */
const createProject = async (req, res, next) => {
  const { expert_id, client_id, type, total_amount, status, deliverable, end_date } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  // Validate required fields
  const errors = {};
  if (!expert_id) errors.expert_id = 'Expert ID is required';
  if (!client_id) errors.client_id = 'Client ID is required';
  
  if (!type) {
    errors.type = 'Project type is required';
  } else if (!validTypes.includes(type)) {
    errors.type = `Invalid project type. Must be one of: ${validTypes.join(', ')}`;
  }

  if (total_amount === undefined || total_amount === null || total_amount === '') {
    errors.total_amount = 'Total amount is required';
  } else {
    const parsedAmount = parseFloat(total_amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      errors.total_amount = 'Total amount must be a positive number';
    }
  }

  if (status && !validStatuses.includes(status)) {
    errors.status = `Invalid status. Must be one of: ${validStatuses.join(', ')}`;
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed');
    err.statusCode = 400;
    err.errors = errors;
    return next(err);
  }

  try {
    // Check if expert exists
    const expertCheck = await pool.query('SELECT 1 FROM expert_profiles WHERE id = $1', [expert_id]);
    if (expertCheck.rows.length === 0) {
      const userCheck = await pool.query("SELECT role FROM users WHERE id = $1", [expert_id]);
      if (userCheck.rows.length === 0 || userCheck.rows[0].role !== 'expert') {
        const err = new Error('Expert not found or invalid user role');
        err.statusCode = 400;
        return next(err);
      }
      await pool.query('INSERT INTO expert_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [expert_id]);
    }

    // Check if client exists
    const clientCheck = await pool.query('SELECT 1 FROM client_profiles WHERE id = $1', [client_id]);
    if (clientCheck.rows.length === 0) {
      const userCheck = await pool.query("SELECT role FROM users WHERE id = $1", [client_id]);
      if (userCheck.rows.length === 0 || userCheck.rows[0].role !== 'client') {
        const err = new Error('Client not found or invalid user role');
        err.statusCode = 400;
        return next(err);
      }
      await pool.query('INSERT INTO client_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [client_id]);
    }

    // Check authorization: is admin or either the client or expert
    if (userRole !== 'admin' && userId !== client_id && userId !== expert_id) {
      const err = new Error('Forbidden: You can only create projects associated with your account');
      err.statusCode = 403;
      return next(err);
    }

    const insertQuery = `
      INSERT INTO projects (expert_id, client_id, type, total_amount, status, deliverable, end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      expert_id,
      client_id,
      type,
      parseFloat(total_amount),
      status || 'active',
      deliverable !== undefined ? !!deliverable : false,
      end_date ? new Date(end_date) : null
    ];

    const result = await pool.query(insertQuery, values);

    return res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: result.rows[0]
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get all projects for the current user (my projects)
 * @route   GET /api/projects/my
 * @access  Private
 */
const getMyProjects = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const query = `
      SELECT p.*, 
             u_expert.full_name as expert_name, 
             u_client.full_name as client_name
      FROM projects p
      JOIN users u_expert ON p.expert_id = u_expert.id
      JOIN users u_client ON p.client_id = u_client.id
      WHERE p.client_id = $1 OR p.expert_id = $1
      ORDER BY p.start_date DESC;
    `;
    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      projects: result.rows,
      data: result.rows
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Update a project
 * @route   PUT /api/projects/:id
 * @access  Private
 */
const updateProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { type, total_amount, status, deliverable, end_date } = req.body;

  try {
    // Fetch project to verify ownership
    const projectCheck = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectCheck.rows[0];

    // Check ownership
    if (userRole !== 'admin' && userId !== project.client_id && userId !== project.expert_id) {
      const err = new Error('Forbidden: You can only update your own projects');
      err.statusCode = 403;
      return next(err);
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (type !== undefined) {
      if (!validTypes.includes(type)) {
        const err = new Error(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`type = $${paramCount}`);
      values.push(type);
      paramCount++;
    }

    if (total_amount !== undefined) {
      const parsedAmount = parseFloat(total_amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        const err = new Error('Total amount must be a positive number');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`total_amount = $${paramCount}`);
      values.push(parsedAmount);
      paramCount++;
    }

    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`status = $${paramCount}`);
      values.push(status);
      paramCount++;
    }

    if (deliverable !== undefined) {
      updates.push(`deliverable = $${paramCount}`);
      values.push(!!deliverable);
      paramCount++;
    }

    if (end_date !== undefined) {
      updates.push(`end_date = $${paramCount}`);
      values.push(end_date ? new Date(end_date) : null);
      paramCount++;
    }

    if (updates.length === 0) {
      const err = new Error('No fields to update');
      err.statusCode = 400;
      return next(err);
    }

    values.push(id);
    const updateQuery = `
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, values);

    return res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      project: result.rows[0]
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Delete a project
 * @route   DELETE /api/projects/:id
 * @access  Private
 */
const deleteProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Fetch project
    const projectCheck = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectCheck.rows[0];

    // Check authorization: only admin or the client/expert who owns it
    if (userRole !== 'admin' && userId !== project.client_id && userId !== project.expert_id) {
      const err = new Error('Forbidden: You can only delete your own projects');
      err.statusCode = 403;
      return next(err);
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createProject,
  getMyProjects,
  updateProject,
  deleteProject
};
