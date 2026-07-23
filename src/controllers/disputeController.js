const { pool } = require('../config/db');
const { sendNotification } = require('../utils/notificationService');

/**
 * @desc    File/raise a dispute on a project
 * @route   POST /api/projects/:id/dispute
 * @access  Private (Client or Expert involved in the project)
 */
const raiseDispute = async (req, res, next) => {
  const { id: projectId } = req.params;
  const userId = req.user.id;
  const { title, type, content, evidence_urls } = req.body;

  if (!title || !content) {
    const err = new Error('Dispute title and description/content are required');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();

  try {
    // 1. Fetch project details
    const projectRes = await dbClient.query(
      `SELECT p.*, uc.full_name as client_name, ue.full_name as expert_name
       FROM projects p
       JOIN users uc ON p.client_id = uc.id
       JOIN users ue ON p.expert_id = ue.id
       WHERE p.id = $1;`,
      [projectId]
    );

    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectRes.rows[0];

    // 2. Access control: Only project client or expert can file a dispute
    if (project.client_id !== userId && project.expert_id !== userId && req.user.role !== 'admin') {
      const err = new Error('Forbidden: You are not a participant in this project');
      err.statusCode = 403;
      return next(err);
    }

    // 3. Check current project status
    const currentStatus = String(project.status).toLowerCase();
    if (currentStatus === 'disputed') {
      const err = new Error('A dispute is already active for this project');
      err.statusCode = 400;
      return next(err);
    }

    if (currentStatus === 'completed' || currentStatus === 'terminated') {
      const err = new Error('Cannot file a dispute on a closed or completed project');
      err.statusCode = 400;
      return next(err);
    }

    const creatorId = userId;
    const targetId = userId === project.client_id ? project.expert_id : project.client_id;

    // 4. Auto-fetch conversation message logs between creator and target
    let messageLogText = '';
    try {
      const msgRes = await dbClient.query(
        `SELECT m.content, m.send_at, u.full_name as sender_name
         FROM messages m
         JOIN users u ON m.user_id = u.id
         JOIN conversations c ON m.conversation_id = c.id
         WHERE (c.sender_id = $1 AND c.target_id = $2)
            OR (c.sender_id = $2 AND c.target_id = $1)
         ORDER BY m.send_at DESC
         LIMIT 20;`,
        [creatorId, targetId]
      );

      if (msgRes.rows.length > 0) {
        messageLogText = JSON.stringify(msgRes.rows.reverse());
      }
    } catch (msgErr) {
      console.warn('[Dispute Controller] Could not fetch message logs:', msgErr.message);
    }

    const evidenceText = Array.isArray(evidence_urls)
      ? JSON.stringify(evidence_urls)
      : (evidence_urls || '');

    // 5. Begin DB Transaction
    await dbClient.query('BEGIN');

    // Create dispute entry
    const insertDisputeQuery = `
      INSERT INTO disputes (
        creator_id, target_id, project_id, title, type, content, evidence_urls, message_log, is_resolved
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
      RETURNING *;
    `;

    const disputeRes = await dbClient.query(insertDisputeQuery, [
      creatorId,
      targetId,
      projectId,
      title.trim(),
      type || 'General Dispute',
      content.trim(),
      evidenceText,
      messageLogText
    ]);

    const createdDispute = disputeRes.rows[0];

    // Update project status to 'disputed'
    await dbClient.query(
      `UPDATE projects SET status = 'disputed' WHERE id = $1;`,
      [projectId]
    );

    await dbClient.query('COMMIT');

    // 6. Notifications
    try {
      await sendNotification(creatorId, {
        title: "Dispute Submitted",
        message: `Your dispute for project "${project.title}" has been submitted and is under admin review. Project escrow is on hold.`,
        type: "new_project",
        referenceId: projectId
      });

      await sendNotification(targetId, {
        title: "Dispute Raised on Project",
        message: `A dispute has been raised on project "${project.title}". The project has been placed on hold pending admin review.`,
        type: "new_project",
        referenceId: projectId
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] raiseDispute:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Dispute submitted successfully. Project is now on hold under admin review.',
      dispute: createdDispute
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Get dispute status for a specific project
 * @route   GET /api/projects/:id/dispute
 * @access  Private (Project participants or Admin)
 */
const getProjectDispute = async (req, res, next) => {
  const { id: projectId } = req.params;

  try {
    const disputeRes = await pool.query(
      `SELECT d.*, 
              uc.full_name as creator_name, uc.email as creator_email,
              ut.full_name as target_name, ut.email as target_email
       FROM disputes d
       JOIN users uc ON d.creator_id = uc.id
       JOIN users ut ON d.target_id = ut.id
       WHERE d.project_id = $1
       ORDER BY d.created_at DESC
       LIMIT 1;`,
      [projectId]
    );

    if (disputeRes.rows.length === 0) {
      return res.status(200).json({
        success: true,
        dispute: null
      });
    }

    return res.status(200).json({
      success: true,
      dispute: disputeRes.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  raiseDispute,
  getProjectDispute
};
