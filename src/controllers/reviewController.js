/**
 * Backend module: controllers/reviewController.js
 *
 * Vai trò: Controller review Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
const { pool } = require('../config/db');

/**
 * Helper to update user/expert rating calculations
 */
async function updateRatingCalculation(dbClient, targetUserId, stars) {
  const parsedStars = parseInt(stars, 10);
  if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) return;

  // Check target user rating record
  const userCheck = await dbClient.query('SELECT rating FROM users WHERE id = $1', [targetUserId]);
  let currentRatingId = userCheck.rows.length > 0 ? userCheck.rows[0].rating : null;
  let rateSum = 0;
  let count = 0;

  if (!currentRatingId) {
    const insertRatingRes = await dbClient.query(
      'INSERT INTO rating (rate_sum, count) VALUES ($1, $2) RETURNING *;',
      [parsedStars, 1]
    );
    currentRatingId = insertRatingRes.rows[0].id;
    rateSum = parsedStars;
    count = 1;
    await dbClient.query('UPDATE users SET rating = $1 WHERE id = $2;', [currentRatingId, targetUserId]);
  } else {
    const updateRatingRes = await dbClient.query(
      `UPDATE rating 
       SET count = count + 1, rate_sum = rate_sum + $1 
       WHERE id = $2 
       RETURNING *;`,
      [parsedStars, currentRatingId]
    );
    rateSum = updateRatingRes.rows[0].rate_sum;
    count = updateRatingRes.rows[0].count;
  }

  const avgRating = count > 0 ? Math.round((rateSum / count) * 10) / 10 : 0;
  // If target is an expert, update expert_profiles.avg_rating
  await dbClient.query(
    'UPDATE expert_profiles SET avg_rating = $1 WHERE id = $2;',
    [avgRating, targetUserId]
  );
}

/**
 * @desc    Create a review (User reviewing User or Project Partner)
 * @route   POST /api/reviews
 * @access  Private
 */
const createReview = async (req, res, next) => {
  const creator_id = req.user.id;
  const { target_id, project_id, stars, review } = req.body;

  if (!target_id && !project_id) {
    const err = new Error('Target ID or Project ID is required');
    err.statusCode = 400;
    return next(err);
  }

  const parsedStars = parseInt(stars || 5, 10);
  if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
    const err = new Error('Rating stars must be between 1 and 5');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    let finalTargetId = target_id;
    let verifiedProjectId = project_id || null;

    // Handle Project-specific Review validation
    if (project_id) {
      const projectRes = await dbClient.query('SELECT * FROM projects WHERE id = $1', [project_id]);
      if (projectRes.rows.length === 0) {
        const err = new Error('Project not found');
        err.statusCode = 404;
        await dbClient.query('ROLLBACK');
        return next(err);
      }
      const project = projectRes.rows[0];

      // Check if project is completed
      const normStatus = String(project.status).toLowerCase();
      if (normStatus !== 'completed') {
        const err = new Error('Reviews can only be submitted for completed projects');
        err.statusCode = 400;
        await dbClient.query('ROLLBACK');
        return next(err);
      }

      // Check participation
      if (project.client_id !== creator_id && project.expert_id !== creator_id) {
        const err = new Error('Forbidden: You can only review projects you participated in');
        err.statusCode = 403;
        await dbClient.query('ROLLBACK');
        return next(err);
      }

      // Determine target user if not specified
      if (!finalTargetId) {
        finalTargetId = creator_id === project.client_id ? project.expert_id : project.client_id;
      }

      // Check 14-day limit from completion date
      const endDate = project.end_date ? new Date(project.end_date) : new Date();
      const diffDays = (new Date() - endDate) / (1000 * 60 * 60 * 24);
      if (diffDays > 14) {
        const err = new Error('The 14-day review period for this project has expired.');
        err.statusCode = 400;
        await dbClient.query('ROLLBACK');
        return next(err);
      }

      // Single-submission check per user per project
      const existingRes = await dbClient.query(
        'SELECT id FROM review WHERE creator_id = $1 AND project_id = $2',
        [creator_id, project_id]
      );
      if (existingRes.rows.length > 0) {
        const err = new Error('You have already submitted a review for this project.');
        err.statusCode = 400;
        await dbClient.query('ROLLBACK');
        return next(err);
      }
    } else if (target_id) {
      // Check if target is a service, in which case we review the expert who owns it
      const serviceCheck = await dbClient.query('SELECT expert_id FROM services WHERE id = $1', [target_id]);
      if (serviceCheck.rows.length > 0) {
        finalTargetId = serviceCheck.rows[0].expert_id;
      }
    }

    // Verify target user exists
    const userCheck = await dbClient.query('SELECT 1 FROM users WHERE id = $1', [finalTargetId]);
    if (userCheck.rows.length === 0) {
      const err = new Error('Target user not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // Insert Review object
    const insertQuery = `
      INSERT INTO review (creator_id, target_id, project_id, stars, review) 
      VALUES ($1, $2, $3, $4, $5) 
      RETURNING *;
    `;
    const result = await dbClient.query(insertQuery, [
      creator_id,
      finalTargetId,
      verifiedProjectId,
      parsedStars,
      review ? review.trim() : ''
    ]);

    // Perform rating updates
    await updateRatingCalculation(dbClient, finalTargetId, parsedStars);

    await dbClient.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Review created successfully',
      review: result.rows[0]
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Get all reviews for a target user
 * @route   GET /api/reviews/target/:targetId
 * @access  Public
 */
const getReviewByTargetId = async (req, res, next) => {
  const { targetId } = req.params;

  try {
    const query = `
      SELECT r.*, u.full_name as creator_name, u.email as creator_email
      FROM review r
      JOIN users u ON r.creator_id = u.id
      WHERE r.target_id = $1
      ORDER BY r.created_at DESC;
    `;
    const result = await pool.query(query, [targetId]);

    return res.status(200).json({
      success: true,
      reviews: result.rows
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Check review status for a specific project for current user
 * @route   GET /api/reviews/project/:projectId/status
 * @access  Private
 */
const getProjectReviewStatus = async (req, res, next) => {
  const { projectId } = req.params;
  const userId = req.user.id;

  try {
    const projectRes = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (projectRes.rows.length === 0) {
      const err = new Error('Project not found');
      err.statusCode = 404;
      return next(err);
    }

    const project = projectRes.rows[0];
    const normStatus = String(project.status).toLowerCase();
    const isCompleted = normStatus === 'completed';

    const endDate = project.end_date ? new Date(project.end_date) : new Date();
    const daysSinceCompletion = isCompleted ? (new Date() - endDate) / (1000 * 60 * 60 * 24) : 0;
    const isWithin14Days = isCompleted && daysSinceCompletion <= 14;
    const daysRemaining = Math.max(0, Math.ceil(14 - daysSinceCompletion));

    // Determine target user ID (the other participant)
    const targetUserId = userId === project.client_id ? project.expert_id : project.client_id;
    const targetInfo = await pool.query('SELECT id, full_name, role FROM users WHERE id = $1', [targetUserId]);
    const targetUser = targetInfo.rows[0] || null;

    // Query existing review by creator for this project
    const reviewRes = await pool.query(
      'SELECT * FROM review WHERE creator_id = $1 AND project_id = $2',
      [userId, projectId]
    );

    const hasReviewed = reviewRes.rows.length > 0;
    const review = hasReviewed ? reviewRes.rows[0] : null;

    return res.status(200).json({
      success: true,
      projectId,
      isCompleted,
      daysSinceCompletion,
      isWithin14Days,
      daysRemaining,
      hasReviewed,
      review,
      targetUser
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createReview,
  getReviewByTargetId,
  getProjectReviewStatus
};
