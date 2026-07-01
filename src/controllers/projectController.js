const { pool } = require('../config/db');

<<<<<<< Updated upstream
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
=======
/**
 * @desc    Create a project from a job post with an accepted proposal (Client only)
 * @route   POST /api/projects
 * @access  Private (Client only)
 */
const createProject = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can start a project');
    err.statusCode = 403;
    return next(err);
  }

  const { job_id } = req.body;

  if (!job_id) {
    const err = new Error('Job post ID is required');
    err.statusCode = 400;
>>>>>>> Stashed changes
    return next(err);
  }

  try {
<<<<<<< Updated upstream
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
=======
    // Start transaction
    await pool.query('BEGIN');

    // 1. Fetch job post details
    const jobRes = await pool.query('SELECT * FROM job_posts WHERE id = $1', [job_id]);
    if (jobRes.rows.length === 0) {
      await pool.query('ROLLBACK');
      const err = new Error('Job post not found');
      err.statusCode = 404;
      return next(err);
    }
    const jobPost = jobRes.rows[0];

    // Verify ownership
    if (jobPost.client_id !== userId && userRole !== 'admin') {
      await pool.query('ROLLBACK');
      const err = new Error('Forbidden: You can only start a project for your own job posts');
>>>>>>> Stashed changes
      err.statusCode = 403;
      return next(err);
    }

<<<<<<< Updated upstream
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
=======
    // 2. Fetch accepted proposal for this job post
    const proposalRes = await pool.query(
      'SELECT * FROM proposals WHERE job_id = $1 AND status = $2 LIMIT 1',
      [job_id, 'accepted']
    );
    if (proposalRes.rows.length === 0) {
      await pool.query('ROLLBACK');
      const err = new Error('No accepted proposal found for this job post. Please accept a proposal first.');
      err.statusCode = 400;
      return next(err);
    }
    const proposal = proposalRes.rows[0];

    // 3. Create the project
    const insertProjectQuery = `
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, title, description, start_date)
      VALUES ($1, $2, 'fixed_milestone', 'active', $3, $4, $5, CURRENT_TIMESTAMP)
      RETURNING *;
    `;
    const projectRes = await pool.query(insertProjectQuery, [
      proposal.expert_id,
      jobPost.client_id,
      proposal.bid_amount,
      jobPost.title,
      jobPost.description
    ]);
    const project = projectRes.rows[0];

    // 4. Delete the job post (this will cascade and delete associated proposals)
    await pool.query('DELETE FROM job_posts WHERE id = $1', [job_id]);

    await pool.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Project started and job post transferred successfully',
      project
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    return next(error);
>>>>>>> Stashed changes
  }
};

/**
<<<<<<< Updated upstream
 * @desc    Get all projects for the current user (my projects)
 * @route   GET /api/projects/my
=======
 * @desc    Get all projects for the current user
 * @route   GET /api/projects
>>>>>>> Stashed changes
 * @access  Private
 */
const getMyProjects = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const query = `
      SELECT p.*, 
<<<<<<< Updated upstream
             u_expert.full_name as expert_name, 
             u_client.full_name as client_name
      FROM projects p
      JOIN users u_expert ON p.expert_id = u_expert.id
      JOIN users u_client ON p.client_id = u_client.id
      WHERE p.client_id = $1 OR p.expert_id = $1
      ORDER BY p.start_date DESC;
    `;
=======
             u_client.full_name AS client_name, u_client.email AS client_email,
             u_expert.full_name AS expert_name, u_expert.email AS expert_email
      FROM projects p
      JOIN users u_client ON p.client_id = u_client.id
      JOIN users u_expert ON p.expert_id = u_expert.id
      WHERE p.client_id = $1 OR p.expert_id = $1
      ORDER BY p.start_date DESC;
    `;

>>>>>>> Stashed changes
    const result = await pool.query(query, [userId]);

    return res.status(200).json({
      success: true,
      projects: result.rows,
      data: result.rows
    });
<<<<<<< Updated upstream
  } catch (err) {
    return next(err);
=======
  } catch (error) {
    return next(error);
>>>>>>> Stashed changes
  }
};

/**
<<<<<<< Updated upstream
 * @desc    Update a project
=======
 * @desc    Get project by ID
 * @route   GET /api/projects/:id
 * @access  Private
 */
const getProjectById = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const query = `
      SELECT p.*, 
             u_client.full_name AS client_name, u_client.email AS client_email,
             u_expert.full_name AS expert_name, u_expert.email AS expert_email
      FROM projects p
      JOIN users u_client ON p.client_id = u_client.id
      JOIN users u_expert ON p.expert_id = u_expert.id
      WHERE p.id = $1;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = result.rows[0];

    // Access control: client, expert, or admin
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You are not a participant of this project');
      err.statusCode = 403;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      project
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Update project details / Close project
>>>>>>> Stashed changes
 * @route   PUT /api/projects/:id
 * @access  Private
 */
const updateProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
<<<<<<< Updated upstream
  const { type, total_amount, status, deliverable, end_date } = req.body;

  try {
    // Fetch project to verify ownership
    const projectCheck = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) {
=======
  const { status, title, description } = req.body;

  try {
    // 1. Fetch project
    const selectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
>>>>>>> Stashed changes
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }
<<<<<<< Updated upstream

    const project = projectCheck.rows[0];

    // Check ownership
    if (userRole !== 'admin' && userId !== project.client_id && userId !== project.expert_id) {
      const err = new Error('Forbidden: You can only update your own projects');
=======
    const project = selectRes.rows[0];

    // Access Control
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You cannot update this project');
>>>>>>> Stashed changes
      err.statusCode = 403;
      return next(err);
    }

<<<<<<< Updated upstream
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
=======
    const fieldsToUpdate = [];
    const values = [];
    let paramIdx = 1;

    // Check status changes
    if (status) {
      if (status === 'terminated') {
        // Client or admin can close/abandon the project
        if (project.client_id !== userId && userRole !== 'admin') {
          const err = new Error('Forbidden: Only the client can abandon the project');
          err.statusCode = 403;
          return next(err);
        }
        fieldsToUpdate.push(`status = $${paramIdx++}`);
        values.push('terminated');
        fieldsToUpdate.push(`end_date = CURRENT_TIMESTAMP`);
      } else {
        fieldsToUpdate.push(`status = $${paramIdx++}`);
        values.push(status);
      }
    }

    if (title !== undefined) {
      fieldsToUpdate.push(`title = $${paramIdx++}`);
      values.push(title.trim());
    }

    if (description !== undefined) {
      fieldsToUpdate.push(`description = $${paramIdx++}`);
      values.push(description.trim());
    }

    if (fieldsToUpdate.length === 0) {
      const err = new Error('No field provided to update');
>>>>>>> Stashed changes
      err.statusCode = 400;
      return next(err);
    }

    values.push(id);
    const updateQuery = `
      UPDATE projects
<<<<<<< Updated upstream
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, values);
=======
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *;
    `;

    const updateRes = await pool.query(updateQuery, values);
>>>>>>> Stashed changes

    return res.status(200).json({
      success: true,
      message: 'Project updated successfully',
<<<<<<< Updated upstream
      project: result.rows[0]
    });
  } catch (err) {
    return next(err);
=======
      project: updateRes.rows[0]
    });

  } catch (error) {
    return next(error);
>>>>>>> Stashed changes
  }
};

/**
<<<<<<< Updated upstream
 * @desc    Delete a project
=======
 * @desc    Delete project (Admin or Owner client)
>>>>>>> Stashed changes
 * @route   DELETE /api/projects/:id
 * @access  Private
 */
const deleteProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
<<<<<<< Updated upstream
    // Fetch project
    const projectCheck = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (projectCheck.rows.length === 0) {
=======
    const selectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (selectRes.rows.length === 0) {
>>>>>>> Stashed changes
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }
<<<<<<< Updated upstream

    const project = projectCheck.rows[0];

    // Check authorization: only admin or the client/expert who owns it
    if (userRole !== 'admin' && userId !== project.client_id && userId !== project.expert_id) {
      const err = new Error('Forbidden: You can only delete your own projects');
=======
    const project = selectRes.rows[0];

    if (project.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the client who created this project or admin can delete it');
>>>>>>> Stashed changes
      err.statusCode = 403;
      return next(err);
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
<<<<<<< Updated upstream
  } catch (err) {
    return next(err);
=======
  } catch (error) {
    return next(error);
>>>>>>> Stashed changes
  }
};

module.exports = {
  createProject,
  getMyProjects,
<<<<<<< Updated upstream
=======
  getProjectById,
>>>>>>> Stashed changes
  updateProject,
  deleteProject
};
