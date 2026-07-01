const { pool } = require('../config/db');

/**
 * @desc    Create a new milestone for a project
 * @route   POST /api/milestones/project/:projectId
 * @access  Private (Expert only)
 */
const createMilestone = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { title, content, amount, due_date } = req.body;

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can create milestones');
    err.statusCode = 403;
    return next(err);
  }

  if (!title || typeof title !== 'string' || title.trim() === '') {
    const err = new Error('Milestone title is required');
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
    // 1. Verify project exists and belongs to the expert
    const projectCheck = await pool.query(
      'SELECT id, expert_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectCheck.rows[0];
    if (project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only create milestones for your own projects');
      err.statusCode = 403;
      return next(err);
    }

    // 2. Insert Milestone
    const insertQuery = `
      INSERT INTO milestones (project_id, title, content, amount, status, due_date)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [
      projectId,
      title.trim(),
      content ? content.trim() : null,
      parsedAmount,
      due_date || null
    ]);

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
 * @access  Private (Client, Expert or Admin)
 */
const getMilestonesByProject = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // 1. Verify project access
    const projectCheck = await pool.query(
      'SELECT client_id, expert_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectCheck.rows[0];
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You do not have access to this project');
      err.statusCode = 403;
      return next(err);
    }

    // 2. Fetch milestones
    const query = `
      SELECT * FROM milestones
      WHERE project_id = $1
      ORDER BY due_date ASC, id ASC;
    `;
    const result = await pool.query(query, [projectId]);

    return res.status(200).json({
      success: true,
      milestones: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Update a milestone
 * @route   PUT /api/milestones/:id
 * @access  Private (Expert only)
 */
const updateMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { title, content, amount, due_date } = req.body;

  try {
    // 1. Fetch milestone & project details to verify ownership
    const milestoneQuery = `
      SELECT m.*, p.expert_id 
      FROM milestones m
      JOIN projects p ON m.project_id = p.id
      WHERE m.id = $1;
    `;
    const milestoneRes = await pool.query(milestoneQuery, [id]);

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only update milestones for your own projects');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'pending') {
      const err = new Error('Forbidden: Only pending milestones can be updated');
      err.statusCode = 400;
      return next(err);
    }

    // Validation
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (title !== undefined) {
      if (!title || title.trim() === '') {
        const err = new Error('Milestone title cannot be empty');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`title = $${paramIdx++}`);
      values.push(title.trim());
    }

    if (content !== undefined) {
      updates.push(`content = $${paramIdx++}`);
      values.push(content ? content.trim() : null);
    }

    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        const err = new Error('Amount must be a positive number');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`amount = $${paramIdx++}`);
      values.push(parsedAmount);
    }

    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIdx++}`);
      values.push(due_date || null);
    }

    if (updates.length === 0) {
      const err = new Error('No update fields provided');
      err.statusCode = 400;
      return next(err);
    }

    values.push(id);
    const updateQuery = `
      UPDATE milestones
      SET ${updates.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, values);
    return res.status(200).json({
      success: true,
      message: 'Milestone updated successfully',
      milestone: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Delete a milestone
 * @route   DELETE /api/milestones/:id
 * @access  Private (Expert only)
 */
const deleteMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneQuery = `
      SELECT m.*, p.expert_id 
      FROM milestones m
      JOIN projects p ON m.project_id = p.id
      WHERE m.id = $1;
    `;
    const milestoneRes = await pool.query(milestoneQuery, [id]);

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only delete milestones for your own projects');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'pending') {
      const err = new Error('Forbidden: Only pending milestones can be deleted');
      err.statusCode = 400;
      return next(err);
    }

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
 * @desc    Start payment / fund / release milestone
 * @route   PUT /api/milestones/:id/pay
 * @access  Private (Client only)
 */
const payMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // 1. Fetch milestone and verify project/client ownership
    const milestoneQuery = `
      SELECT m.*, p.client_id, p.expert_id, p.status as project_status
      FROM milestones m
      JOIN projects p ON m.project_id = p.id
      WHERE m.id = $1;
    `;
    const milestoneRes = await pool.query(milestoneQuery, [id]);

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the client who created the project can pay for milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'pending') {
      const err = new Error('Forbidden: Only pending milestones can be paid');
      err.statusCode = 400;
      return next(err);
    }

    // 2. Execute payment transaction
    await pool.query('BEGIN');

    // Update milestone status to 'released'
    const updateMilestoneRes = await pool.query(
      "UPDATE milestones SET status = 'released' WHERE id = $1 RETURNING *;",
      [id]
    );
    const updatedMilestone = updateMilestoneRes.rows[0];

    // Log transaction
    const transactionQuery = `
      INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
      VALUES ($1, $2, $3, $4, 'escrow_release', 'completed', CURRENT_TIMESTAMP)
      RETURNING *;
    `;
    const transactionRes = await pool.query(transactionQuery, [
      milestone.project_id,
      milestone.client_id,
      milestone.expert_id,
      milestone.amount
    ]);
    const transaction = transactionRes.rows[0];

    // Log payment
    await pool.query(
      `INSERT INTO payments (project_id, transaction_id, user_id, amount, type)
       VALUES ($1, $2, $3, $4, 'momo');`,
      [milestone.project_id, transaction.id, milestone.client_id, milestone.amount]
    );

    // Check if all milestones of the project are now released
    const allMilestonesQuery = `
      SELECT status FROM milestones
      WHERE project_id = $1;
    `;
    const allMilestonesRes = await pool.query(allMilestonesQuery, [milestone.project_id]);
    const allMilestones = allMilestonesRes.rows;

    const allReleased = allMilestones.length > 0 && allMilestones.every(m => m.status === 'released');

    if (allReleased) {
      // Auto-fill end_date and set status to 'completed'
      const updateProjectQuery = `
        UPDATE projects
        SET status = 'completed', end_date = CURRENT_TIMESTAMP
        WHERE id = $1;
      `;
      await pool.query(updateProjectQuery, [milestone.project_id]);
    }

    await pool.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Milestone payment completed successfully',
      milestone: updatedMilestone,
      projectCompleted: allReleased
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
