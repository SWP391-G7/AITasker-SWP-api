const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

// Helper to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const toDateOnly = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * @desc    Get platform-wide analytics calculated from live database records
 * @route   GET /api/admin/analytics
 * @access  Private (Admin)
 */
const getAnalytics = async (req, res, next) => {
  try {
    const requestedTo = req.query.to ? new Date(req.query.to) : new Date();
    const endDate = Number.isNaN(requestedTo.getTime()) ? new Date() : requestedTo;
    const requestedFrom = req.query.from
      ? new Date(req.query.from)
      : new Date(endDate.getFullYear(), 0, 1);
    const startDate = Number.isNaN(requestedFrom.getTime())
      ? new Date(endDate.getFullYear(), 0, 1)
      : requestedFrom;

    if (startDate > endDate) {
      const err = new Error('The analytics start date must not be after the end date');
      err.statusCode = 400;
      return next(err);
    }

    const from = toDateOnly(startDate);
    const to = toDateOnly(endDate);

    // Run independent aggregate queries in parallel to keep the endpoint responsive.
    const [
      userSummaryRes,
      projectSummaryRes,
      revenueSummaryRes,
      revenueByMonthRes,
      engagementRes,
      topExpertsRes,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE role = 'expert' AND acc_status = true) AS active_experts,
          COUNT(*) FILTER (WHERE role <> 'admin') AS total_members,
          COUNT(*) FILTER (WHERE role <> 'admin' AND acc_status = false) AS inactive_members
        FROM users;
      `),
      pool.query(`
        SELECT
          COUNT(*) AS total_projects,
          COUNT(*) FILTER (WHERE LOWER(status::text) = 'completed') AS completed_projects,
          COALESCE(AVG(total_amount), 0) AS average_task_price
        FROM projects
        WHERE start_date::date BETWEEN $1::date AND $2::date;
      `, [from, to]),
      pool.query(`
        SELECT COALESCE(SUM(amount), 0) AS total_revenue
        FROM transactions
        WHERE status::text = 'completed'
          AND type::text = 'escrow_release'
          AND complete_at::date BETWEEN $1::date AND $2::date;
      `, [from, to]),
      pool.query(`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', $1::date) - interval '4 months',
            date_trunc('month', $1::date),
            interval '1 month'
          ) AS month_start
        )
        SELECT
          TO_CHAR(months.month_start, 'Mon') AS label,
          TO_CHAR(months.month_start, 'YYYY-MM') AS month_key,
          COALESCE(SUM(t.amount), 0) AS revenue
        FROM months
        LEFT JOIN transactions t
          ON t.complete_at >= months.month_start
          AND t.complete_at < months.month_start + interval '1 month'
          AND t.status::text = 'completed'
          AND t.type::text = 'escrow_release'
        GROUP BY months.month_start
        ORDER BY months.month_start;
      `, [to]),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE role = 'client' AND acc_status = true) AS active_clients,
          (SELECT COUNT(DISTINCT client_id) FROM projects
            WHERE start_date::date BETWEEN $1::date AND $2::date) AS engaged_clients,
          (SELECT COUNT(*) FROM users WHERE role = 'expert' AND acc_status = true) AS active_experts,
          (SELECT COUNT(DISTINCT expert_id) FROM projects
            WHERE start_date::date BETWEEN $1::date AND $2::date) AS engaged_experts;
      `, [from, to]),
      pool.query(`
        WITH project_stats AS (
          SELECT
            expert_id,
            COUNT(*) AS total_projects,
            COUNT(*) FILTER (WHERE LOWER(status::text) = 'completed') AS completed_projects
          FROM projects
          WHERE start_date::date BETWEEN $1::date AND $2::date
          GROUP BY expert_id
        ),
        revenue_stats AS (
          SELECT
            receiver_id AS expert_id,
            COALESCE(SUM(amount), 0) AS revenue
          FROM transactions
          WHERE status::text = 'completed'
            AND type::text = 'escrow_release'
            AND complete_at::date BETWEEN $1::date AND $2::date
          GROUP BY receiver_id
        )
        SELECT
          u.id,
          u.full_name,
          u.avatar_url,
          u.acc_status,
          ep.professional_title,
          ep.skills,
          ep.avg_rating,
          COALESCE(ps.total_projects, 0) AS total_projects,
          COALESCE(ps.completed_projects, 0) AS completed_projects,
          COALESCE(rs.revenue, 0) AS revenue
        FROM users u
        JOIN expert_profiles ep ON ep.id = u.id
        LEFT JOIN project_stats ps ON ps.expert_id = u.id
        LEFT JOIN revenue_stats rs ON rs.expert_id = u.id
        WHERE u.role = 'expert'
        ORDER BY
          COALESCE(rs.revenue, 0) DESC,
          COALESCE(ps.completed_projects, 0) DESC,
          ep.avg_rating DESC,
          u.full_name ASC
        LIMIT 5;
      `, [from, to]),
    ]);

    const users = userSummaryRes.rows[0];
    const projects = projectSummaryRes.rows[0];
    const revenue = revenueSummaryRes.rows[0];
    const engagement = engagementRes.rows[0];
    const totalProjects = Number(projects.total_projects) || 0;
    const completedProjects = Number(projects.completed_projects) || 0;
    const activeClients = Number(engagement.active_clients) || 0;
    const activeExperts = Number(engagement.active_experts) || 0;
    const totalMembers = Number(users.total_members) || 0;

    // Engagement is used as a transparent proxy because login-history data is not stored yet.
    const clientEngagementRate = activeClients
      ? (Number(engagement.engaged_clients) / activeClients) * 100
      : 0;
    const expertEngagementRate = activeExperts
      ? (Number(engagement.engaged_experts) / activeExperts) * 100
      : 0;
    const inactiveAccountRate = totalMembers
      ? (Number(users.inactive_members) / totalMembers) * 100
      : 0;

    return res.status(200).json({
      success: true,
      period: { from, to },
      summary: {
        totalRevenue: Number(revenue.total_revenue) || 0,
        completionRate: totalProjects ? (completedProjects / totalProjects) * 100 : 0,
        activeExperts: Number(users.active_experts) || 0,
        averageTaskPrice: Number(projects.average_task_price) || 0,
        totalProjects,
        completedProjects,
      },
      revenueByMonth: revenueByMonthRes.rows.map((row) => ({
        label: row.label,
        monthKey: row.month_key,
        revenue: Number(row.revenue) || 0,
      })),
      engagement: {
        clientRate: clientEngagementRate,
        expertRate: expertEngagementRate,
        inactiveAccountRate,
      },
      topExperts: topExpertsRes.rows.map((expert) => {
        const expertProjects = Number(expert.total_projects) || 0;
        const expertCompletedProjects = Number(expert.completed_projects) || 0;

        return {
          id: expert.id,
          name: expert.full_name,
          avatarUrl: expert.avatar_url,
          specialization: expert.professional_title || expert.skills || 'AI Specialist',
          rating: Number(expert.avg_rating) || 0,
          totalProjects: expertProjects,
          completedProjects: expertCompletedProjects,
          completionRate: expertProjects ? (expertCompletedProjects / expertProjects) * 100 : 0,
          revenue: Number(expert.revenue) || 0,
          status: expert.acc_status ? 'Active' : 'Suspended',
        };
      }),
      definitions: {
        revenue: 'Completed escrow releases during the selected period',
        engagement: 'Active accounts that participated in at least one project during the selected period',
      },
    });
  } catch (err) {
    return next(err);
  }
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
 * @desc    Get all disputes with joined user, project, milestone financial details, and evidence
 * @route   GET /api/admin/disputes
 * @access  Private (Admin)
 */
const getDisputes = async (req, res, next) => {
  try {
    const query = `
      SELECT 
        d.id,
        d.id as dispute_id,
        d.project_id,
        d.creator_id,
        d.target_id,
        d.title,
        d.type,
        d.content,
        d.evidence_urls,
        d.message_log,
        d.is_resolved,
        d.resolution_type,
        d.admin_notes,
        d.created_at,
        d.resolved_at,
        p.title as project_title,
        p.total_amount as project_total_amount,
        p.status as project_status,
        uc.full_name as creator_name,
        uc.email as creator_email,
        uc.role as creator_role,
        ut.full_name as target_name,
        ut.email as target_email,
        ut.role as target_role,
        cli.full_name as client_name,
        cli.id as client_id,
        exp.full_name as expert_name,
        exp.id as expert_id
      FROM disputes d
      JOIN projects p ON d.project_id = p.id
      LEFT JOIN users uc ON d.creator_id = uc.id
      LEFT JOIN users ut ON d.target_id = ut.id
      LEFT JOIN users cli ON p.client_id = cli.id
      LEFT JOIN users exp ON p.expert_id = exp.id
      ORDER BY d.created_at DESC;
    `;
    const result = await pool.query(query);

    // Attach milestone financial details to each dispute
    const disputes = await Promise.all(
      result.rows.map(async (dispute) => {
        const milestonesRes = await pool.query(
          'SELECT amount, status, released_amount FROM milestones WHERE project_id = $1',
          [dispute.project_id]
        );

        let totalReleased = 0;
        milestonesRes.rows.forEach((m) => {
          const status = String(m.status).toLowerCase();
          if (status === 'released' || status === 'finished' || status === 'approved') {
            totalReleased += parseFloat(m.released_amount || m.amount || 0);
          }
        });

        const totalAmount = parseFloat(dispute.project_total_amount || 0);
        const remainingEscrow = Math.max(0, totalAmount - totalReleased);

        return {
          ...dispute,
          value: `$${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
          released_amount: totalReleased,
          remaining_escrow: remainingEscrow,
          status: dispute.is_resolved
            ? (dispute.resolution_type === 'refund_client' ? 'Resolved (Refunded)' : 'Resolved (Released)')
            : 'Under Review'
        };
      })
    );

    return res.status(200).json({
      success: true,
      disputes
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Resolve a dispute (refund client or release remaining escrow to expert)
 * @route   POST /api/admin/disputes/:id/resolve
 * @access  Private (Admin)
 */
const resolveDispute = async (req, res, next) => {
  const { id } = req.params; // Can be dispute_id or project_id
  const { resolution, admin_notes, apply_ban_user_id } = req.body; // 'refund_client' or 'release_expert'

  if (!['refund_client', 'release_expert'].includes(resolution)) {
    const err = new Error("Invalid resolution. Must be 'refund_client' or 'release_expert'");
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // 1. Find dispute record (by dispute id or project id)
    let disputeRes = await dbClient.query('SELECT * FROM disputes WHERE id = $1', [id]);
    if (disputeRes.rows.length === 0) {
      disputeRes = await dbClient.query('SELECT * FROM disputes WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
    }

    let dispute = disputeRes.rows[0];
    const projectId = dispute ? dispute.project_id : id;

    // 2. Find project
    const projectRes = await dbClient.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      const err = new Error('Project associated with dispute not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const project = projectRes.rows[0];

    // 3. Calculate remaining escrow balance (total project amount minus already released milestone funds)
    const milestonesRes = await dbClient.query(
      'SELECT amount, status, released_amount FROM milestones WHERE project_id = $1',
      [projectId]
    );

    let totalReleased = 0;
    milestonesRes.rows.forEach((m) => {
      const status = String(m.status).toLowerCase();
      if (status === 'released' || status === 'finished' || status === 'approved') {
        totalReleased += parseFloat(m.released_amount || m.amount || 0);
      }
    });

    const totalProjectAmount = parseFloat(project.total_amount || 0);
    const remainingEscrow = Math.max(0, totalProjectAmount - totalReleased);

    const newProjectStatus = resolution === 'refund_client' ? 'terminated' : 'completed';

    // 4. Update project status
    await dbClient.query(
      "UPDATE projects SET status = $1, end_date = CURRENT_TIMESTAMP WHERE id = $2",
      [newProjectStatus, projectId]
    );

    // 5. Handle financial transfers for remaining escrow balance
    if (resolution === 'refund_client') {
      if (remainingEscrow > 0) {
        await dbClient.query(
          `UPDATE client_profiles SET budget = budget + $1 WHERE id = $2;`,
          [remainingEscrow, project.client_id]
        );
        await dbClient.query(
          `INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
           VALUES ($1, $2, $2, $3, 'refund', 'completed', CURRENT_TIMESTAMP);`,
          [projectId, project.client_id, remainingEscrow]
        );
      }
    } else {
      if (remainingEscrow > 0) {
        await dbClient.query(
          `INSERT INTO transactions (project_id, sender_id, receiver_id, amount, type, status, complete_at)
           VALUES ($1, $2, $3, $4, 'escrow_release', 'completed', CURRENT_TIMESTAMP);`,
          [projectId, project.client_id, project.expert_id, remainingEscrow]
        );
      }
    }

    // 6. Update dispute record if exists
    if (dispute) {
      await dbClient.query(
        `UPDATE disputes 
         SET is_resolved = true, resolution_type = $1, admin_notes = $2, resolved_at = CURRENT_TIMESTAMP 
         WHERE id = $3;`,
        [resolution, admin_notes || null, dispute.id]
      );
    }

    // 7. Apply optional user penalty / ban if requested by admin
    if (apply_ban_user_id) {
      await dbClient.query(
        `UPDATE users SET acc_status = false WHERE id = $1;`,
        [apply_ban_user_id]
      );
    }

    await dbClient.query('COMMIT');

    // 8. Trigger Notifications
    try {
      const { sendNotification } = require('../utils/notificationService');
      const outcomeText = resolution === 'refund_client'
        ? `Dispute resolved in favor of the client. Unreleased escrow ($${remainingEscrow.toFixed(2)}) has been refunded.`
        : `Dispute resolved in favor of the expert. Escrow payment ($${remainingEscrow.toFixed(2)}) has been released.`;

      await sendNotification(project.client_id, {
        title: "Dispute Resolved",
        message: `Project "${project.title}": ${outcomeText}`,
        type: "project_finished",
        referenceId: projectId
      });

      await sendNotification(project.expert_id, {
        title: "Dispute Resolved",
        message: `Project "${project.title}": ${outcomeText}`,
        type: "project_finished",
        referenceId: projectId
      });
    } catch (notifErr) {
      console.error('[Notification Trigger Error] resolveDispute:', notifErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Dispute resolved successfully (${resolution})`,
      projectStatus: newProjectStatus,
      refundedOrReleasedAmount: remainingEscrow
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

module.exports = {
  getAnalytics,
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
