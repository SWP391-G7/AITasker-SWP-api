const { pool } = require('../config/db');
const { sendNotification } = require('../utils/notificationService');

/* ─────────────────────────────────────────────────────────────────────────────
   PLAN PHASE
   Expert batch-submits a set of milestones for client review.
───────────────────────────────────────────────────────────────────────────── */

/**
 * @desc    Bulk-create and submit a milestone plan for a project
 * @route   POST /api/milestones/project/:projectId/submit-plan
 * @access  Private (Expert only)
 * @body    { milestones: [{ title, content, amount, delivery_days }] }
 */
const submitMilestonePlan = async (req, res, next) => {
  const { projectId } = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { milestones } = req.body;

  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only experts can submit milestone plans');
    err.statusCode = 403;
    return next(err);
  }

  if (!Array.isArray(milestones) || milestones.length === 0) {
    const err = new Error('At least one milestone is required');
    err.statusCode = 400;
    return next(err);
  }

  // Validate each milestone
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (!m.title || String(m.title).trim() === '') {
      const err = new Error(`Milestone ${i + 1}: title is required`);
      err.statusCode = 400;
      return next(err);
    }
    const amt = parseFloat(m.amount);
    if (isNaN(amt) || amt <= 0) {
      const err = new Error(`Milestone ${i + 1}: amount must be a positive number`);
      err.statusCode = 400;
      return next(err);
    }
    const days = parseInt(m.delivery_days, 10);
    if (isNaN(days) || days <= 0) {
      const err = new Error(`Milestone ${i + 1}: delivery_days must be a positive integer`);
      err.statusCode = 400;
      return next(err);
    }
  }

  try {
    // Verify project exists and belongs to the expert
    const projectCheck = await pool.query(
      'SELECT id, expert_id, duration_days FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectCheck.rows[0];
    if (project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only submit plans for your own projects');
      err.statusCode = 403;
      return next(err);
    }

    const planDuration = milestones.reduce(
      (total, milestone) => total + parseInt(milestone.delivery_days, 10),
      0
    );
    const projectDuration = parseInt(project.duration_days, 10);
    const extensionRequested = !isNaN(projectDuration) && projectDuration > 0 && planDuration > projectDuration;

    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      // Delete any existing planning / change_requested / Pending / Declined milestones (clean slate on re-submit)
      await dbClient.query(
        "DELETE FROM milestones WHERE project_id = $1 AND status IN ('planning', 'change_requested', 'Pending', 'Declined')",
        [projectId]
      );

      // Insert new milestones in order
      const created = [];
      for (let i = 0; i < milestones.length; i++) {
        const m   = milestones[i];
        const row = await dbClient.query(
          `INSERT INTO milestones
             (project_id, title, content, amount, delivery_days, status, position)
           VALUES ($1, $2, $3, $4, $5, 'planning', $6)
           RETURNING *;`,
          [
            projectId,
            String(m.title).trim(),
            m.content ? String(m.content).trim() : null,
            parseFloat(m.amount),
            parseInt(m.delivery_days, 10),
            i + 1,
          ]
        );
        created.push(row.rows[0]);
      }

      await dbClient.query('COMMIT');
    } catch (txError) {
      await dbClient.query('ROLLBACK');
      throw txError;
    } finally {
      dbClient.release();
    }

    // Trigger Notification
    try {
      const projectRes = await pool.query('SELECT client_id, title FROM projects WHERE id = $1', [projectId]);
      if (projectRes.rows.length > 0) {
        const { client_id: clientId, title: projectTitle } = projectRes.rows[0];
        const expertInfo = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
        const expertName = expertInfo.rows[0]?.full_name || 'Expert';

        await sendNotification(clientId, {
          title: "New Milestones Proposed",
          message: `Expert ${expertName} has proposed a milestone plan for "${projectTitle}". Please review it.`,
          type: "new_milestones",
          referenceId: projectId
        });
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] submitMilestonePlan:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Milestone plan submitted for client review',
      milestones: created,
      extensionRequested,
      requestedDurationDays: extensionRequested ? planDuration : null,
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
  const userId   = req.user.id;
  const userRole = req.user.role;

  try {
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

    const result = await pool.query(
      'SELECT * FROM milestones WHERE project_id = $1 ORDER BY position ASC, id ASC;',
      [projectId]
    );

    return res.status(200).json({ success: true, milestones: result.rows });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Approve the submitted milestone plan (all planning → planned)
 * @route   PUT /api/milestones/project/:projectId/approve-plan
 * @access  Private (Client only)
 */
const approveMilestonePlan = async (req, res, next) => {
  const { projectId } = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { approve_duration_extension: approveDurationExtension = false } = req.body || {};

  try {
    const projectCheck = await pool.query(
      'SELECT id, client_id, total_amount, duration_days FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    if (projectCheck.rows[0].client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can approve the plan');
      err.statusCode = 403;
      return next(err);
    }

    const planningCount = await pool.query(
      "SELECT COUNT(*) FROM milestones WHERE project_id = $1 AND status = 'planning'",
      [projectId]
    );

    if (parseInt(planningCount.rows[0].count, 10) === 0) {
      const err = new Error('No planning milestones found to approve');
      err.statusCode = 400;
      return next(err);
    }

    const planTotalRes = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(delivery_days), 0) AS total_days FROM milestones WHERE project_id = $1 AND status = 'planning'",
      [projectId]
    );
    const planTotal = parseFloat(planTotalRes.rows[0].total || 0);
    const projectTotal = parseFloat(projectCheck.rows[0].total_amount || 0);
    if (Math.abs(planTotal - projectTotal) > 0.01) {
      const err = new Error(`Milestone amounts must total the project value (${projectTotal.toFixed(2)}). Current total: ${planTotal.toFixed(2)}`);
      err.statusCode = 400;
      return next(err);
    }

    const planDuration = parseInt(planTotalRes.rows[0].total_days || 0, 10);
    const projectDuration = parseInt(projectCheck.rows[0].duration_days, 10);
    const durationExtended = !isNaN(projectDuration) && projectDuration > 0 && planDuration > projectDuration;
    if (durationExtended) {
      if (!approveDurationExtension) {
        const err = new Error(
          `This plan requests a duration extension from ${projectDuration} to ${planDuration} days. Client approval of the extension is required.`
        );
        err.statusCode = 400;
        return next(err);
      }
      await pool.query('UPDATE projects SET duration_days = $1 WHERE id = $2', [planDuration, projectId]);
    }

    const result = await pool.query(
      "UPDATE milestones SET status = 'planned' WHERE project_id = $1 AND status = 'planning' RETURNING *;",
      [projectId]
    );

    return res.status(200).json({
      success: true,
      message: 'Milestone plan approved',
      milestones: result.rows,
      durationExtended,
      durationDays: durationExtended ? planDuration : projectDuration,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Request changes to the plan (per-milestone notes; all planning → change_requested)
 * @route   PUT /api/milestones/project/:projectId/request-changes
 * @access  Private (Client only)
 * @body    { notes: { [milestoneId]: "note text" } }
 */
const requestPlanChanges = async (req, res, next) => {
  const { projectId } = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { notes } = req.body; // { milestoneId: noteText }

  try {
    const projectCheck = await pool.query(
      'SELECT id, client_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (projectCheck.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    if (projectCheck.rows[0].client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can request plan changes');
      err.statusCode = 403;
      return next(err);
    }

    const planningRes = await pool.query(
      "SELECT id FROM milestones WHERE project_id = $1 AND status = 'planning'",
      [projectId]
    );

    if (planningRes.rows.length === 0) {
      const err = new Error('No planning milestones found');
      err.statusCode = 400;
      return next(err);
    }

    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      const updated = [];
      for (const row of planningRes.rows) {
        const note = (notes && notes[row.id]) ? String(notes[row.id]).trim() : null;
        const r = await dbClient.query(
          "UPDATE milestones SET status = 'change_requested', change_request_note = $1 WHERE id = $2 RETURNING *;",
          [note, row.id]
        );
        updated.push(r.rows[0]);
      }

      await dbClient.query('COMMIT');
    } catch (txErr) {
      await dbClient.query('ROLLBACK');
      throw txErr;
    } finally {
      dbClient.release();
    }

    return res.status(200).json({
      success: true,
      message: 'Change request submitted to expert',
      milestones: updated,
    });
  } catch (error) {
    return next(error);
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   WORK PHASE
   Expert starts / submits deliverables; client reviews and pays.
───────────────────────────────────────────────────────────────────────────── */

/**
 * @desc    Update a milestone (only when planning or change_requested)
 * @route   PUT /api/milestones/:id
 * @access  Private (Expert only)
 */
const updateMilestone = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { title, content, amount, delivery_days } = req.body;

  try {
    const milestoneRes = await pool.query(
      'SELECT m.*, p.expert_id FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;',
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only update your own milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (!['planning', 'change_requested', 'Pending', 'Declined'].includes(milestone.status)) {
      const err = new Error('Only planning, change-requested, Pending, or Declined milestones can be updated');
      err.statusCode = 400;
      return next(err);
    }

    const updates = [];
    const values  = [];
    let   idx     = 1;

    if (title !== undefined) {
      if (!title || String(title).trim() === '') {
        const err = new Error('Title cannot be empty');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`title = $${idx++}`);
      values.push(String(title).trim());
    }
    if (content !== undefined) {
      updates.push(`content = $${idx++}`);
      values.push(content ? String(content).trim() : null);
    }
    if (amount !== undefined) {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) {
        const err = new Error('Amount must be a positive number');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`amount = $${idx++}`);
      values.push(parsed);
    }
    if (delivery_days !== undefined) {
      const parsed = parseInt(delivery_days, 10);
      if (isNaN(parsed) || parsed <= 0) {
        const err = new Error('Delivery days must be a positive integer');
        err.statusCode = 400;
        return next(err);
      }
      updates.push(`delivery_days = $${idx++}`);
      values.push(parsed);
    }

    if (updates.length === 0) {
      const err = new Error('No update fields provided');
      err.statusCode = 400;
      return next(err);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE milestones SET ${updates.join(', ')}, status = 'Pending', response = NULL WHERE id = $${idx} RETURNING *;`,
      values
    );

    return res.status(200).json({ success: true, milestone: result.rows[0] });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Delete a milestone (only when planning or change_requested)
 * @route   DELETE /api/milestones/:id
 * @access  Private (Expert only)
 */
const deleteMilestone = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneRes = await pool.query(
      'SELECT m.*, p.expert_id FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;',
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only delete your own milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (!['planning', 'change_requested'].includes(milestone.status)) {
      const err = new Error('Only planning or change-requested milestones can be deleted');
      err.statusCode = 400;
      return next(err);
    }

    await pool.query('DELETE FROM milestones WHERE id = $1', [id]);

    return res.status(200).json({ success: true, message: 'Milestone deleted' });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Start a planned milestone (checks sequential order)
 * @route   PUT /api/milestones/:id/start
 * @access  Private (Expert only)
 */
const startMilestone = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.expert_id, p.status AS project_status
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only start your own milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'planned' && milestone.status !== 'Approved') {
      const err = new Error('Milestone must be in "planned" or "Approved" state to start');
      err.statusCode = 400;
      return next(err);
    }

    // Enforce sequential order: all milestones with lower position must be finished/pending_payment
    const blockCheck = await pool.query(
      `SELECT COUNT(*) FROM milestones
       WHERE project_id = $1 AND position < $2
         AND status NOT IN ('finished', 'pending_payment')`,
      [milestone.project_id, milestone.position]
    );

    if (parseInt(blockCheck.rows[0].count, 10) > 0) {
      const err = new Error('Cannot start: a previous milestone is not yet finished');
      err.statusCode = 400;
      return next(err);
    }

    // Compute deadline = today + delivery_days
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + (milestone.delivery_days || 7));

    const result = await pool.query(
      "UPDATE milestones SET status = 'ongoing', deadline = $1 WHERE id = $2 RETURNING *;",
      [deadline.toISOString(), id]
    );

    return res.status(200).json({
      success: true,
      message: 'Milestone started',
      milestone: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Submit a deliverable link for a milestone
 * @route   PUT /api/milestones/:id/submit-deliverable
 * @access  Private (Expert only)
 * @body    { deliverable_url, deliverable_note }
 */
const submitDeliverable = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { deliverable_url, deliverable_note } = req.body;

  if (!deliverable_url || String(deliverable_url).trim() === '') {
    const err = new Error('Deliverable URL is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const milestoneRes = await pool.query(
      'SELECT m.*, p.expert_id, p.client_id FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;',
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only submit deliverables for your own milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (!['ongoing', 'revision_requested'].includes(milestone.status)) {
      const err = new Error('Milestone must be ongoing or revision-requested to submit a deliverable');
      err.statusCode = 400;
      return next(err);
    }

    const result = await pool.query(
      `UPDATE milestones
       SET status = 'submitted',
           deliverable_url  = $1,
           deliverable_note = $2,
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           change_request_note = NULL
       WHERE id = $3 RETURNING *;`,
      [
        String(deliverable_url).trim(),
        deliverable_note ? String(deliverable_note).trim() : null,
        id,
      ]
    );
    const updatedMilestone = result.rows[0];

    // Trigger Notification
    try {
      await sendNotification(milestone.client_id, {
        title: "Milestone Deliverable Submitted",
        message: `The expert has submitted a deliverable for milestone "${updatedMilestone.title}".`,
        type: "milestone_submitted",
        referenceId: updatedMilestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] submitDeliverable:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Deliverable submitted for client review',
      milestone: updatedMilestone,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Approve a submitted deliverable and release its agreed escrow amount
 * @route   PUT /api/milestones/:id/approve-deliverable
 * @access  Private (Client only)
 */
const approveDeliverable = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  let dbClient;

  try {
    const milestoneRes = await pool.query(
      'SELECT m.*, p.client_id, p.expert_id, p.total_amount FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;',
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can approve deliverables');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'submitted') {
      const err = new Error('Milestone must be in "submitted" state to approve');
      err.statusCode = 400;
      return next(err);
    }

    dbClient = await pool.connect();
    await dbClient.query('BEGIN');
    const lockRes = await dbClient.query('SELECT status FROM milestones WHERE id = $1 FOR UPDATE', [id]);
    if (!lockRes.rows.length || lockRes.rows[0].status !== 'submitted') {
      const err = new Error('Milestone was already processed');
      err.statusCode = 409;
      throw err;
    }

    const escrowRes = await dbClient.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_deposit' AND status = 'completed'), 0) AS deposited,
         COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_release' AND status = 'completed'), 0) AS released,
         COALESCE(SUM(amount) FILTER (WHERE type = 'refund' AND status = 'completed'), 0) AS refunded
       FROM transactions WHERE project_id = $1`,
      [milestone.project_id]
    );
    const deposited = parseFloat(escrowRes.rows[0].deposited || 0);
    const released = parseFloat(escrowRes.rows[0].released || 0);
    const refunded = parseFloat(escrowRes.rows[0].refunded || 0);
    const milestoneAmount = parseFloat(milestone.amount || 0);
    const submittedAt = milestone.submitted_at ? new Date(milestone.submitted_at) : new Date();
    const deadline = milestone.deadline ? new Date(milestone.deadline) : null;
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const lateDays = deadline && submittedAt > deadline
      ? Math.ceil((submittedAt.getTime() - deadline.getTime()) / millisecondsPerDay)
      : 0;
    const penaltyRate = Math.min(lateDays * 0.01, 0.2);
    const penaltyAmount = Math.round(milestoneAmount * penaltyRate * 100) / 100;
    const releaseAmount = Math.round((milestoneAmount - penaltyAmount) * 100) / 100;
    if (releaseAmount <= 0 || released + refunded + milestoneAmount > deposited + 0.01) {
      const err = new Error('Insufficient project escrow for this milestone release');
      err.statusCode = 400;
      throw err;
    }

    const result = await dbClient.query(
      "UPDATE milestones SET status = 'finished', late_days = $2, penalty_amount = $3, released_amount = $4 WHERE id = $1 RETURNING *;",
      [id, lateDays, penaltyAmount, releaseAmount]
    );
    const transactionRes = await dbClient.query(
      `INSERT INTO transactions (project_id, milestone_id, sender_id, receiver_id, amount, type, status, funding_source, wallet_amount, external_amount, complete_at)
       VALUES ($1, $2, $3, $4, $5, 'escrow_release', 'completed', 'escrow', 0, 0, CURRENT_TIMESTAMP)
       RETURNING *;`,
      [milestone.project_id, milestone.id, milestone.client_id, milestone.expert_id, releaseAmount]
    );

    let refundTransaction = null;
    if (penaltyAmount > 0) {
      const refundRes = await dbClient.query(
        `INSERT INTO transactions (project_id, milestone_id, sender_id, receiver_id, amount, type, status, funding_source, wallet_amount, external_amount, complete_at)
         VALUES ($1, $2, $3, $3, $4, 'refund', 'completed', 'escrow', $4, 0, CURRENT_TIMESTAMP)
         RETURNING *;`,
        [milestone.project_id, milestone.id, milestone.client_id, penaltyAmount]
      );
      refundTransaction = refundRes.rows[0];
      await dbClient.query(
        'UPDATE client_profiles SET budget = COALESCE(budget, 0) + $1 WHERE id = $2',
        [penaltyAmount, milestone.client_id]
      );
    }

    const remainingRes = await dbClient.query(
      "SELECT COUNT(*)::int AS count FROM milestones WHERE project_id = $1 AND status <> 'finished'",
      [milestone.project_id]
    );
    const projectCompleted = remainingRes.rows[0].count === 0;
    if (projectCompleted) {
      await dbClient.query("UPDATE projects SET status = 'Completed', end_date = CURRENT_TIMESTAMP WHERE id = $1", [milestone.project_id]);
    }
    await dbClient.query('COMMIT');

    try {
      await sendNotification(milestone.expert_id, {
        title: 'Milestone Approved — Payment Released',
        message: lateDays > 0
          ? `The client approved "${milestone.title}". ${lateDays} late day(s) resulted in a ${penaltyAmount.toFixed(2)} penalty; ${releaseAmount.toFixed(2)} was released.`
          : `The client approved "${milestone.title}" and released ${releaseAmount.toFixed(2)} from escrow.`,
        type: 'milestone_approved',
        referenceId: milestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] approveDeliverable:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Deliverable approved and milestone funds released from escrow',
      milestone: result.rows[0],
      transaction: transactionRes.rows[0],
      refundTransaction,
      lateDays,
      penaltyAmount,
      releasedAmount: releaseAmount,
      projectCompleted,
    });
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    if (dbClient) dbClient.release();
  }
};

/** Expert requests extra time for a milestone that is already in progress. */
const requestDeadlineExtension = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const additionalDays = parseInt(req.body?.additional_days, 10);
  const reason = String(req.body?.reason || '').trim();

  try {
    if (!Number.isInteger(additionalDays) || additionalDays < 1 || additionalDays > 90) {
      const err = new Error('Additional days must be an integer between 1 and 90');
      err.statusCode = 400;
      return next(err);
    }
    if (reason.length < 10) {
      const err = new Error('Please provide a reason of at least 10 characters');
      err.statusCode = 400;
      return next(err);
    }
    const milestoneRes = await pool.query(
      'SELECT m.*, p.expert_id, p.client_id FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.id = $1',
      [id]
    );
    if (!milestoneRes.rows.length) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }
    const milestone = milestoneRes.rows[0];
    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the assigned expert can request an extension');
      err.statusCode = 403;
      return next(err);
    }
    if (!['ongoing', 'revision_requested'].includes(milestone.status)) {
      const err = new Error('An extension can only be requested while the milestone is in progress');
      err.statusCode = 400;
      return next(err);
    }
    if (milestone.extension_status === 'pending') {
      const err = new Error('An extension request is already awaiting client review');
      err.statusCode = 409;
      return next(err);
    }
    const result = await pool.query(
      `UPDATE milestones SET extension_requested_days = $1, extension_reason = $2,
       extension_status = 'pending', extension_requested_at = CURRENT_TIMESTAMP,
       extension_response_note = NULL WHERE id = $3 RETURNING *`,
      [additionalDays, reason, id]
    );
    try {
      await sendNotification(milestone.client_id, {
        title: 'Milestone Extension Requested',
        message: `The expert requested ${additionalDays} extra day(s) for "${milestone.title}".`,
        type: 'milestone_submitted',
        referenceId: id
      });
    } catch (notificationError) {
      console.error('[Notification Trigger Error] requestDeadlineExtension:', notificationError.message);
    }
    return res.status(200).json({ success: true, milestone: result.rows[0] });
  } catch (error) {
    return next(error);
  }
};

/** Client approves or rejects an expert's deadline extension request. */
const respondDeadlineExtension = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const action = String(req.body?.action || '').toLowerCase();
  const note = String(req.body?.note || '').trim();
  let dbClient;

  try {
    if (!['approve', 'reject'].includes(action)) {
      const err = new Error('Action must be approve or reject');
      err.statusCode = 400;
      return next(err);
    }
    dbClient = await pool.connect();
    await dbClient.query('BEGIN');
    const milestoneRes = await dbClient.query(
      `SELECT m.*, p.client_id, p.expert_id FROM milestones m
       JOIN projects p ON p.id = m.project_id WHERE m.id = $1 FOR UPDATE OF m`,
      [id]
    );
    if (!milestoneRes.rows.length) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      throw err;
    }
    const milestone = milestoneRes.rows[0];
    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can respond to an extension request');
      err.statusCode = 403;
      throw err;
    }
    if (milestone.extension_status !== 'pending') {
      const err = new Error('No pending extension request found');
      err.statusCode = 400;
      throw err;
    }
    const days = parseInt(milestone.extension_requested_days, 10);
    let result;
    if (action === 'approve') {
      result = await dbClient.query(
        `UPDATE milestones SET deadline = deadline + ($1 * INTERVAL '1 day'),
         delivery_days = delivery_days + $1, extension_status = 'approved', extension_response_note = $2
         WHERE id = $3 RETURNING *`,
        [days, note || null, id]
      );
      await dbClient.query('UPDATE projects SET duration_days = COALESCE(duration_days, 0) + $1 WHERE id = $2', [days, milestone.project_id]);
    } else {
      result = await dbClient.query(
        "UPDATE milestones SET extension_status = 'rejected', extension_response_note = $1 WHERE id = $2 RETURNING *",
        [note || null, id]
      );
    }
    await dbClient.query('COMMIT');
    try {
      await sendNotification(milestone.expert_id, {
        title: action === 'approve' ? 'Milestone Extension Approved' : 'Milestone Extension Rejected',
        message: `Your ${days}-day extension request for "${milestone.title}" was ${action === 'approve' ? 'approved' : 'rejected'}.`,
        type: action === 'approve' ? 'milestone_approved' : 'milestone_rejected',
        referenceId: id
      });
    } catch (notificationError) {
      console.error('[Notification Trigger Error] respondDeadlineExtension:', notificationError.message);
    }
    return res.status(200).json({ success: true, action, milestone: result.rows[0] });
  } catch (error) {
    if (dbClient) await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    if (dbClient) dbClient.release();
  }
};

/**
 * @desc    Request revision on a submitted deliverable (submitted → revision_requested)
 * @route   PUT /api/milestones/:id/request-revision
 * @access  Private (Client only)
 * @body    { note }
 */
const requestRevision = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;
  const { note } = req.body;

  try {
    const milestoneRes = await pool.query(
      'SELECT m.*, p.client_id, p.expert_id FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;',
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can request revisions');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.status !== 'submitted') {
      const err = new Error('Milestone must be in "submitted" state to request revision');
      err.statusCode = 400;
      return next(err);
    }

    const result = await pool.query(
      "UPDATE milestones SET status = 'revision_requested', change_request_note = $1 WHERE id = $2 RETURNING *;",
      [note ? String(note).trim() : null, id]
    );
    const updatedMilestone = result.rows[0];

    // Trigger Notification
    try {
      await sendNotification(milestone.expert_id, {
        title: "Milestone Revision Requested",
        message: `The client requested a revision on milestone "${updatedMilestone.title}". Note: "${note || ''}"`,
        type: "milestone_rejected",
        referenceId: updatedMilestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] requestRevision:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Revision requested',
      milestone: updatedMilestone,
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Pay for a milestone (pending_payment → finished); completes project if all finished
 * @route   PUT /api/milestones/:id/pay
 * @access  Private (Client only)
 */
const payMilestone = async (req, res, next) => {
  const { id }   = req.params;
  const userId   = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.client_id, p.expert_id, p.status AS project_status
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can pay for milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (!['Wait for payment', 'pending_payment'].includes(milestone.status)) {
      const err = new Error('Milestone must be awaiting payment');
      err.statusCode = 400;
      return next(err);
    }

    const dbClient = await pool.connect();
    let allFinished = false;
    let updatedMilestone;

    try {
      await dbClient.query('BEGIN');

      // Mark milestone as Finished
      const updatedMilestoneRes = await dbClient.query(
        "UPDATE milestones SET status = 'Finished' WHERE id = $1 RETURNING *;",
        [id]
      );
      updatedMilestone = updatedMilestoneRes.rows[0];

      // Log transaction
      const transactionRes = await dbClient.query(
        `INSERT INTO transactions (project_id, milestone_id, sender_id, receiver_id, amount, type, status, funding_source, complete_at)
         VALUES ($1, $2, $3, $4, $5, 'escrow_release', 'completed', 'escrow', CURRENT_TIMESTAMP) RETURNING *;`,
        [milestone.project_id, milestone.id, milestone.client_id, milestone.expert_id, milestone.amount]
      );
      const transaction = transactionRes.rows[0];

      // Log payment record
      await dbClient.query(
        `INSERT INTO payments (project_id, transaction_id, user_id, amount, type)
         VALUES ($1, $2, $3, $4, 'momo');`,
        [milestone.project_id, transaction.id, milestone.client_id, milestone.amount]
      );

      // Check if ALL milestones are now Finished → complete the project
      const allMilestonesRes = await dbClient.query(
        'SELECT status FROM milestones WHERE project_id = $1;',
        [milestone.project_id]
      );
      allFinished =
        allMilestonesRes.rows.length > 0 &&
        allMilestonesRes.rows.every((m) => m.status === 'Finished');

      if (allFinished) {
        await dbClient.query(
          "UPDATE projects SET status = 'Completed', end_date = CURRENT_TIMESTAMP WHERE id = $1;",
          [milestone.project_id]
        );
      }

      await dbClient.query('COMMIT');
    } catch (txErr) {
      await dbClient.query('ROLLBACK');
      throw txErr;
    } finally {
      dbClient.release();
    }

    // Trigger Notifications
    try {
      if (allFinished) {
        await sendNotification(milestone.client_id, {
          title: "All Milestones Completed",
          message: `Congratulations! All milestones for the project have been completed.`,
          type: "milestones_finished",
          referenceId: milestone.project_id
        });
        await sendNotification(milestone.expert_id, {
          title: "All Milestones Completed",
          message: `Congratulations! All milestones for the project have been completed.`,
          type: "milestones_finished",
          referenceId: milestone.project_id
        });
      } else {
        await sendNotification(milestone.expert_id, {
          title: "Milestone Payment Released",
          message: `The client has released the payment for milestone "${updatedMilestone.title}".`,
          type: "milestone_approved",
          referenceId: updatedMilestone.id
        });
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] payMilestone:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      milestone: updatedMilestone,
      projectCompleted: allFinished,
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    return next(error);
  }
};

/**
 * @desc    Approve a milestone (either during planning or content approval)
 * @route   PUT /api/milestones/:id/approve
 * @access  Private (Client only)
 */
const approveMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.client_id, p.status AS project_status 
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can approve milestones');
      err.statusCode = 403;
      return next(err);
    }

    let targetStatus;
    if (milestone.project_status === 'Planning') {
      targetStatus = 'Approved';
    } else if (milestone.project_status === 'On-going') {
      targetStatus = 'Wait for payment';
    } else {
      const err = new Error('Cannot approve milestones for a project that is not in Planning or On-going status');
      err.statusCode = 400;
      return next(err);
    }

    const result = await pool.query(
      `UPDATE milestones SET status = $1 WHERE id = $2 RETURNING *;`,
      [targetStatus, id]
    );
    const updatedMilestone = result.rows[0];

    // Trigger Notification
    try {
      const type = targetStatus === 'Approved' ? 'milestones_accepted' : 'milestone_approved';
      const titleText = targetStatus === 'Approved' ? 'Milestone Plan Approved' : 'Milestone Work Approved';
      const messageText = targetStatus === 'Approved'
        ? `The client has accepted your milestone plan for "${updatedMilestone.title}".`
        : `The client has approved your submission for milestone "${updatedMilestone.title}".`;

      await sendNotification(milestone.expert_id, {
        title: titleText,
        message: messageText,
        type: type,
        referenceId: updatedMilestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] approveMilestone:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Milestone approved. Status set to ${targetStatus}`,
      milestone: updatedMilestone
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Decline a milestone (either during planning or content approval)
 * @route   PUT /api/milestones/:id/decline
 * @access  Private (Client only)
 */
const declineMilestone = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.client_id, p.expert_id 
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can decline milestones');
      err.statusCode = 403;
      return next(err);
    }

    // Pass the correct parameters (using $1 for status and $2 for id)
    const result = await pool.query(
      `UPDATE milestones SET status = 'Declined' WHERE id = $1 RETURNING *;`,
      [id]
    );
    const updatedMilestone = result.rows[0];

    // Trigger Notification
    try {
      await sendNotification(milestone.expert_id, {
        title: "Milestone Plan Declined",
        message: `The client has declined your milestone "${updatedMilestone.title}".`,
        type: "milestone_rejected",
        referenceId: updatedMilestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] declineMilestone:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Milestone declined successfully',
      milestone: updatedMilestone
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Submit a response content to a declined milestone
 * @route   PUT /api/milestones/:id/response
 * @access  Private (Client only)
 */
const submitMilestoneResponse = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { response } = req.body;

  if (response === undefined || String(response).trim() === '') {
    const err = new Error('Response is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.client_id 
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the project client can submit responses');
      err.statusCode = 403;
      return next(err);
    }

    const result = await pool.query(
      `UPDATE milestones SET response = $1 WHERE id = $2 RETURNING *;`,
      [String(response).trim(), id]
    );

    return res.status(200).json({
      success: true,
      message: 'Response content added to milestone',
      milestone: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Submit/resubmit milestone content (after project is started)
 * @route   PUT /api/milestones/:id/submit-content
 * @access  Private (Expert only)
 */
const submitMilestoneContent = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { content } = req.body;

  if (!content || String(content).trim() === '') {
    const err = new Error('Content is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const milestoneRes = await pool.query(
      `SELECT m.*, p.expert_id, p.client_id, p.status AS project_status 
       FROM milestones m JOIN projects p ON m.project_id = p.id WHERE m.id = $1;`,
      [id]
    );

    if (milestoneRes.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }

    const milestone = milestoneRes.rows[0];

    if (milestone.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only submit content for your own milestones');
      err.statusCode = 403;
      return next(err);
    }

    if (milestone.project_status !== 'On-going') {
      const err = new Error('Cannot submit content unless the project is On-going');
      err.statusCode = 400;
      return next(err);
    }

    const result = await pool.query(
      `UPDATE milestones SET content = $1, status = 'Pending', response = NULL WHERE id = $2 RETURNING *;`,
      [String(content).trim(), id]
    );
    const updatedMilestone = result.rows[0];

    // Trigger Notification
    try {
      await sendNotification(milestone.client_id, {
        title: "Milestone Content Proposed",
        message: `The expert has submitted content for milestone "${updatedMilestone.title}".`,
        type: "milestone_submitted",
        referenceId: updatedMilestone.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] submitMilestoneContent:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Content submitted successfully for client review',
      milestone: updatedMilestone
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Start project (updates project status to On-going)
 * @route   PUT /api/milestones/project/:projectId/start
 * @access  Private (Client only)
 */
const startProject = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const projectRes = await pool.query(
      `SELECT * FROM projects WHERE id = $1;`,
      [projectId]
    );

    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectRes.rows[0];

    if (project.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: Only the client can start the project');
      err.statusCode = 403;
      return next(err);
    }

    if (project.status !== 'Planning') {
      const err = new Error('Project must be in Planning status to start');
      err.statusCode = 400;
      return next(err);
    }

    // Check if there is at least one milestone and all milestones are Approved
    const milestonesCheck = await pool.query(
      `SELECT status FROM milestones WHERE project_id = $1;`,
      [projectId]
    );

    if (milestonesCheck.rows.length === 0) {
      const err = new Error('Cannot start project: Expert has not submitted milestones yet');
      err.statusCode = 400;
      return next(err);
    }

    const allApproved = milestonesCheck.rows.every(m => m.status === 'Approved' || m.status === 'planned');

    if (!allApproved) {
      const err = new Error('Cannot start project: All milestones must be Approved or planned');
      err.statusCode = 400;
      return next(err);
    }

    const result = await pool.query(
      `UPDATE projects SET status = 'On-going' WHERE id = $1 RETURNING *;`,
      [projectId]
    );

    return res.status(200).json({
      success: true,
      message: 'Project started successfully',
      project: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get a single milestone by ID
 * @route   GET /api/milestones/:id
 * @access  Private (Authenticated users only)
 */
const getMilestoneById = async (req, res, next) => {
  const { id } = req.params;
  try {
    const sql = 'SELECT * FROM milestones WHERE id = $1';
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) {
      const err = new Error('Milestone not found');
      err.statusCode = 404;
      return next(err);
    }
    return res.status(200).json({
      success: true,
      milestone: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  submitMilestonePlan,
  getMilestonesByProject,
  approveMilestonePlan,
  requestPlanChanges,
  updateMilestone,
  deleteMilestone,
  startMilestone,
  submitDeliverable,
  approveDeliverable,
  requestRevision,
  requestDeadlineExtension,
  respondDeadlineExtension,
  payMilestone,
  approveMilestone,
  declineMilestone,
  submitMilestoneResponse,
  submitMilestoneContent,
  startProject,
  getMilestoneById,
};

