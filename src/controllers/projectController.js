const { pool } = require('../config/db');
const { sendNotification } = require('../utils/notificationService');

/**
 * @desc    Create a project from an accepted proposal
 * @route   POST /api/projects
 * @access  Private (Client only)
 */
const createProject = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { job_id, proposal_id } = req.body;

  if (userRole !== 'client' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only clients can create projects');
    err.statusCode = 403;
    return next(err);
  }

  if (!job_id && !proposal_id) {
    const err = new Error('Job ID or Proposal ID is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    let proposal;
    let jobPost;

    if (proposal_id) {
      // Find proposal by proposal_id
      const proposalRes = await pool.query(
        'SELECT * FROM proposals WHERE id = $1',
        [proposal_id]
      );
      if (proposalRes.rows.length === 0) {
        const err = new Error('Proposal not found');
        err.statusCode = 404;
        return next(err);
      }
      proposal = proposalRes.rows[0];

      // Find job post
      const jobRes = await pool.query(
        'SELECT * FROM job_posts WHERE id = $1',
        [proposal.job_id]
      );
      if (jobRes.rows.length === 0) {
        const err = new Error('Associated job post not found');
        err.statusCode = 404;
        return next(err);
      }
      jobPost = jobRes.rows[0];
    } else {
      // Find job post first
      const jobRes = await pool.query(
        'SELECT * FROM job_posts WHERE id = $1',
        [job_id]
      );
      if (jobRes.rows.length === 0) {
        const err = new Error('Job post not found');
        err.statusCode = 404;
        return next(err);
      }
      jobPost = jobRes.rows[0];

      // Find accepted proposal for this job post
      const proposalRes = await pool.query(
        "SELECT * FROM proposals WHERE job_id = $1 AND status = 'accepted' LIMIT 1",
        [job_id]
      );
      if (proposalRes.rows.length === 0) {
        const err = new Error('No accepted proposal found for this job post');
        err.statusCode = 400;
        return next(err);
      }
      proposal = proposalRes.rows[0];
    }

    // Verify ownership
    if (jobPost.client_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only start a project for a task you posted');
      err.statusCode = 403;
      return next(err);
    }

    // Verify proposal status
    if (proposal.status !== 'accepted') {
      const err = new Error('Cannot start project: Proposal has not been accepted');
      err.statusCode = 400;
      return next(err);
    }

    if (proposal.payment_status !== 'funded') {
      const err = new Error('Cannot start project: Client payment has not been secured in escrow');
      err.statusCode = 400;
      return next(err);
    }

    // Start Transaction
    await pool.query('BEGIN');

    // 1. Create the project
    const insertQuery = `
      INSERT INTO projects (expert_id, client_id, type, status, total_amount, title, description, proposal_id)
      VALUES ($1, $2, 'fixed_milestone', 'Planning', $3, $4, $5, $6)
      RETURNING *;
    `;
    const projectValues = [
      proposal.expert_id,
      jobPost.client_id,
      proposal.bid_amount,
      jobPost.title,
      jobPost.description,
      proposal.id
    ];
    const projectRes = await pool.query(insertQuery, projectValues);
    const project = projectRes.rows[0];

    await pool.query(
      'UPDATE transactions SET project_id = $1 WHERE proposal_id = $2 AND type = \'escrow_deposit\' AND status = \'completed\'',
      [project.id, proposal.id]
    );

    // 2. Set job post status to 'closed' instead of deleting it
    await pool.query(
      "UPDATE job_posts SET status = 'closed' WHERE id = $1",
      [jobPost.id]
    );

    await pool.query('COMMIT');

    // Trigger Notifications
    try {
      await sendNotification(project.client_id, {
        title: "New Project Started",
        message: `A new project for "${project.title}" has been created.`,
        type: "new_project",
        referenceId: project.id
      });
      await sendNotification(project.expert_id, {
        title: "New Project Started",
        message: `A new project for "${project.title}" has been created.`,
        type: "new_project",
        referenceId: project.id
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] createProject:', notifErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    return next(error);
  }
};

/**
 * @desc    Get all projects for the current user (dashboard list)
 * @route   GET /api/projects
 * @access  Private
 */
const getMyProjects = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query;
    let values;

    if (userRole === 'client') {
      query = `
        SELECT p.*, u.full_name as expert_name, u.email as expert_email
        FROM projects p
        JOIN users u ON p.expert_id = u.id
        WHERE p.client_id = $1
        ORDER BY p.start_date DESC;
      `;
      values = [userId];
    } else if (userRole === 'expert') {
      query = `
        SELECT p.*, u.full_name as client_name, u.email as client_email
        FROM projects p
        JOIN users u ON p.client_id = u.id
        WHERE p.expert_id = $1
        ORDER BY p.start_date DESC;
      `;
      values = [userId];
    } else {
      // Admin gets all
      query = `
        SELECT p.*, uc.full_name as client_name, ue.full_name as expert_name
        FROM projects p
        JOIN users uc ON p.client_id = uc.id
        JOIN users ue ON p.expert_id = ue.id
        ORDER BY p.start_date DESC;
      `;
      values = [];
    }

    const result = await pool.query(query, values);

    return res.status(200).json({
      success: true,
      projects: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get a single project by ID
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
             uc.full_name as client_name, uc.email as client_email,
             ue.full_name as expert_name, ue.email as expert_email
      FROM projects p
      JOIN users uc ON p.client_id = uc.id
      JOIN users ue ON p.expert_id = ue.id
      WHERE p.id = $1;
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = result.rows[0];

    // Check access
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You do not have access to this project');
      err.statusCode = 403;
      return next(err);
    }

    // Fetch milestones for this project
    const milestonesRes = await pool.query(
      'SELECT * FROM milestones WHERE project_id = $1 ORDER BY due_date ASC, id ASC;',
      [id]
    );

    return res.status(200).json({
      success: true,
      project,
      milestones: milestonesRes.rows
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Update project (e.g. close project by client)
 * @route   PUT /api/projects/:id
 * @access  Private
 */
const updateProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;
  const { status } = req.body;

  if (!status) {
    const err = new Error('Status is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const projectRes = await pool.query(
      'SELECT client_id, expert_id, status FROM projects WHERE id = $1;',
      [id]
    );

    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectRes.rows[0];

    // Check access: Only clients or admin can close/abandon the project
    if (status === 'terminated') {
      if (project.client_id !== userId && userRole !== 'admin') {
        const err = new Error('Forbidden: Only the client can close this project');
        err.statusCode = 403;
        return next(err);
      }
    } else {
      // General update
      if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
        const err = new Error('Forbidden: You do not have permission to update this project');
        err.statusCode = 403;
        return next(err);
      }
    }

    const updateQuery = `
      UPDATE projects
      SET status = $1::project_status, end_date = CASE WHEN $1::text = 'terminated' OR $1::text = 'completed' THEN CURRENT_TIMESTAMP ELSE end_date END
      WHERE id = $2
      RETURNING *;
    `;
    const result = await pool.query(updateQuery, [status, id]);
    const updatedProject = result.rows[0];

    // Trigger Notifications
    try {
      const normStatus = String(updatedProject.status).toLowerCase();
      if (normStatus === 'completed') {
        await sendNotification(updatedProject.client_id, {
          title: "Project Completed",
          message: `Project "${updatedProject.title}" has been marked as completed.`,
          type: "project_finished",
          referenceId: updatedProject.id
        });
        await sendNotification(updatedProject.expert_id, {
          title: "Project Completed",
          message: `Project "${updatedProject.title}" has been marked as completed.`,
          type: "project_finished",
          referenceId: updatedProject.id
        });
      }
    } catch (notifErr) {
      console.error('[Notification Trigger Error] updateProject:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Project updated successfully',
      project: updatedProject
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Delete a project
 * @route   DELETE /api/projects/:id
 * @access  Private (Admin or Owner only)
 */
const deleteProject = async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    const projectRes = await pool.query(
      'SELECT client_id, expert_id FROM projects WHERE id = $1;',
      [id]
    );

    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectRes.rows[0];
    if (project.client_id !== userId && project.expert_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You do not have permission to delete this project');
      err.statusCode = 403;
      return next(err);
    }

    await pool.query('DELETE FROM projects WHERE id = $1', [id]);

    return res.status(200).json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createProject,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject
};
