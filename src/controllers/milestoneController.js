const { pool } = require('../config/db');

/**
 * @desc    Create a milestone for a project (Expert only)
 * @route   POST /api/milestones/project/:projectId
 * @access  Private (Expert only)
 */
const createMilestone = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { title, content, amount, due_date } = req.body;

  if (!title || !amount) {
    const err = new Error('Title and amount are required');
    err.statusCode = 400;
    return next(err);
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    const err = new Error('Amount must be a positive number');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // 1. Fetch project and verify ownership
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }
    const project = projectRes.rows[0];

    if (project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the expert assigned to this project can create milestones');
      err.statusCode = 403;
      return next(err);
    }

    // 2. Insert milestone
    const insertQuery = `
      INSERT INTO milestones (project_id, title, content, amount, status, due_date)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING *;
    `;
    const values = [projectId, title.trim(), content ? content.trim() : null, parsedAmount, due_date || null];
    const result = await pool.query(insertQuery, values);

    return res.status(201).json({
      success: true,
      message: 'Milestone created successfully',
      milestone: result.rows[0]
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get milestones for a project
 * @route   GET /api/milestones/project/:projectId
 * @access  Private
 */
const getMilestonesByProject = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Verify user participates in the project
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }
    const project = projectRes.rows[0];

    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You do not participate in this project');
      err.statusCode = 403;
      return next(err);
    }

    const query = `
      SELECT * FROM milestones
      WHERE project_id = $1
      ORDER BY due_date ASC, id ASC;
    `;
    const result = await pool.query(query, [projectId]);

    return res.status(200).json({
      success: true,
      milestones: result.rows,
      data: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Update a milestone (Expert only, must be pending status)
 * @route   PUT /api/milestones/:id
 * @access  Private (Expert only)
 */
const updateMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { title, content, amount, due_date } = req.body;

  try {
    // 1. Fetch milestone
    const milestoneRes = await pool.query('SELECT * FROM milestones WHERE id = $1', [id]);
    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }
    const milestone = milestoneRes.rows[0];

    if (milestone.status !== 'pending') {
      const err = new Error('Forbidden: Cannot update milestone that has been paid or released');
      err.statusCode = 400;
      return next(err);
    }

    // 2. Fetch project and verify ownership
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [milestone.project_id]);
    const project = projectRes.rows[0];

    if (project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the expert assigned to this project can edit milestones');
      err.statusCode = 403;
      return next(err);
    }

    // 3. Build update
    const fieldsToUpdate = [];
    const values = [];
    let paramIdx = 1;

    if (title !== undefined) {
      fieldsToUpdate.push(`title = $${paramIdx++}`);
      values.push(title.trim());
    }

    if (content !== undefined) {
      fieldsToUpdate.push(`content = $${paramIdx++}`);
      values.push(content ? content.trim() : null);
    }

    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        const err = new Error('Amount must be a positive number');
        err.statusCode = 400;
        return next(err);
      }
      fieldsToUpdate.push(`amount = $${paramIdx++}`);
      values.push(parsedAmount);
    }

    if (due_date !== undefined) {
      fieldsToUpdate.push(`due_date = $${paramIdx++}`);
      values.push(due_date || null);
    }

    if (fieldsToUpdate.length === 0) {
      const err = new Error('No fields provided to update');
      err.statusCode = 400;
      return next(err);
    }

    values.push(id);
    const updateQuery = `
      UPDATE milestones
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *;
    `;

    const updateRes = await pool.query(updateQuery, values);

    return res.status(200).json({
      success: true,
      message: 'Milestone updated successfully',
      milestone: updateRes.rows[0]
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Delete a milestone (Expert only, must be pending status)
 * @route   DELETE /api/milestones/:id
 * @access  Private (Expert only)
 */
const deleteMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // 1. Fetch milestone
    const milestoneRes = await pool.query('SELECT * FROM milestones WHERE id = $1', [id]);
    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }
    const milestone = milestoneRes.rows[0];

    if (milestone.status !== 'pending') {
      const err = new Error('Forbidden: Cannot delete milestone that has been paid or released');
      err.statusCode = 400;
      return next(err);
    }

    // 2. Fetch project and verify ownership
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [milestone.project_id]);
    const project = projectRes.rows[0];

    if (project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the expert assigned to this project can delete milestones');
      err.statusCode = 403;
      return next(err);
    }

    // 3. Delete milestone
    await pool.query('DELETE FROM milestones WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: 'Milestone deleted successfully'
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Pay for a milestone (Client only)
 * @route   PUT /api/milestones/:id/pay
 * @access  Private (Client only)
 */
const payMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // 1. Fetch milestone
    const milestoneRes = await pool.query('SELECT * FROM milestones WHERE id = $1', [id]);
    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }
    const milestone = milestoneRes.rows[0];

    if (milestone.status === 'released') {
      const err = new Error('Milestone has already been paid and released');
      err.statusCode = 400;
      return next(err);
    }

    // 2. Fetch project and verify client ownership
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [milestone.project_id]);
    const project = projectRes.rows[0];

    if (project.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the client who created this project can pay for milestones');
      err.statusCode = 403;
      return next(err);
    }

    // 3. Start database transaction
    await pool.query('BEGIN');

    // 3a. Update milestone status to 'released'
    const updateMilestoneRes = await pool.query(
      "UPDATE milestones SET status = 'released' WHERE id = $1 RETURNING *",
      [id]
    );
    const updatedMilestone = updateMilestoneRes.rows[0];

    // 3b. Create transaction record
    const insertTransactionQuery = `
      INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
      VALUES ($1, $2, $3, $4, 'escrow_release', 'completed', CURRENT_TIMESTAMP)
      RETURNING id;
    `;
    const transactionRes = await pool.query(insertTransactionQuery, [
      milestone.project_id,
      project.client_id,
      project.expert_id,
      milestone.amount
    ]);
    const transactionId = transactionRes.rows[0].id;

    // 3c. Create payment record
    const insertPaymentQuery = `
      INSERT INTO payments (project_id, transaction_id, user_id, amount, type, paid_at)
      VALUES ($1, $2, $3, $4, 'credit_card', CURRENT_TIMESTAMP);
    `;
    await pool.query(insertPaymentQuery, [
      milestone.project_id,
      transactionId,
      project.client_id,
      milestone.amount
    ]);

    // 3d. Check if all milestones are now paid ('released')
    const countRes = await pool.query(
      "SELECT COUNT(*) FROM milestones WHERE project_id = $1 AND status != 'released'",
      [milestone.project_id]
    );
    const remainingMilestones = parseInt(countRes.rows[0].count, 10);
    
    // Check if there is at least one milestone and all of them are released
    let projectCompleted = false;
    if (remainingMilestones === 0) {
      await pool.query(
        "UPDATE projects SET status = 'completed', end_date = CURRENT_TIMESTAMP WHERE id = $1",
        [milestone.project_id]
      );
      projectCompleted = true;
    }

    await pool.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Milestone payment completed successfully',
      milestone: updatedMilestone,
      projectCompleted
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    return next(error);
  }
};

module.exports = {
  createMilestone,
  getMilestonesByProject,
  updateMilestone,
  deleteMilestone,
  payMilestone
};
