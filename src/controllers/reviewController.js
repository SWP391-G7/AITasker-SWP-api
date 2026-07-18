const { pool } = require('../config/db');

const rateTargetService = async (dbClient, targetId, targetTable, stars) => {
  let targetCheck;
  if (targetTable === 'services') {
    targetCheck = await dbClient.query('SELECT rating FROM services WHERE id = $1', [targetId]);
  } else {
    targetCheck = await dbClient.query('SELECT rating FROM users WHERE id = $1', [targetId]);
  }

  if (targetCheck.rows.length === 0) return null;

  let ratingId = targetCheck.rows[0].rating;
  let ratingRecord;

  if (!ratingId) {
    const insertRes = await dbClient.query(
      'INSERT INTO rating (rate_sum, count) VALUES ($1, 1) RETURNING *;',
      [stars]
    );
    ratingRecord = insertRes.rows[0];
    ratingId = ratingRecord.id;

    if (targetTable === 'services') {
      await dbClient.query('UPDATE services SET rating = $1 WHERE id = $2;', [ratingId, targetId]);
    } else {
      await dbClient.query('UPDATE users SET rating = $1 WHERE id = $2;', [ratingId, targetId]);
    }
  } else {
    const updateRes = await dbClient.query(
      'UPDATE rating SET count = count + 1, rate_sum = rate_sum + $1 WHERE id = $2 RETURNING *;',
      [stars, ratingId]
    );
    ratingRecord = updateRes.rows[0];
  }

  return ratingRecord;
};

const hasCompletedProject = async (userId1, userId2) => {
  const res = await pool.query(
    `SELECT 1 FROM projects
     WHERE ((client_id = $1 AND expert_id = $2) OR (client_id = $2 AND expert_id = $1))
       AND status = 'Completed'
     LIMIT 1`,
    [userId1, userId2]
  );
  return res.rows.length > 0;
};

const createReview = async (req, res, next) => {
  const creator_id = req.user.id;
  const { target_id, review, stars } = req.body;

  if (!target_id) {
    const err = new Error('Target ID is required');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    let finalTargetId = target_id;
    let serviceId = null;
    let targetTable = 'users';

    // Check if target_id is a service → resolve to expert
    const svcRes = await dbClient.query(
      'SELECT s.*, u.full_name AS expert_name FROM services s JOIN users u ON s.expert_id = u.id WHERE s.id = $1',
      [target_id]
    );
    if (svcRes.rows.length > 0) {
      finalTargetId = svcRes.rows[0].expert_id;
      serviceId = target_id;
      targetTable = 'services';
    } else {
      // Verify target exists as a user
      const userCheck = await dbClient.query('SELECT 1 FROM users WHERE id = $1', [target_id]);
      if (userCheck.rows.length === 0) {
        const err = new Error('Target not found');
        err.statusCode = 404;
        await dbClient.query('ROLLBACK');
        return next(err);
      }
    }

    if (creator_id === finalTargetId) {
      const err = new Error('You cannot review yourself');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const dupCheck = await dbClient.query(
      'SELECT 1 FROM review WHERE creator_id = $1 AND target_id = $2',
      [creator_id, finalTargetId]
    );
    if (dupCheck.rows.length > 0) {
      const err = new Error('You have already reviewed this user');
      err.statusCode = 409;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const completed = await hasCompletedProject(creator_id, finalTargetId);
    if (!completed) {
      const err = new Error('You can only review after completing a project together');
      err.statusCode = 403;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const parsedStars = stars !== undefined && stars !== null ? parseInt(stars, 10) : null;
    if (parsedStars !== null && (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5)) {
      const err = new Error('Stars must be an integer between 1 and 5');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (parsedStars !== null) {
      const userRating = await rateTargetService(dbClient, finalTargetId, 'users', parsedStars);
      if (!userRating) {
        const err = new Error('Failed to update rating');
        err.statusCode = 500;
        await dbClient.query('ROLLBACK');
        return next(err);
      }
      const userAvg = userRating.count > 0
        ? parseFloat((userRating.rate_sum / userRating.count).toFixed(1)) : 0;
      await dbClient.query('UPDATE expert_profiles SET avg_rating = $1 WHERE id = $2;', [userAvg, finalTargetId]);

      if (serviceId) {
        const svcRating = await rateTargetService(dbClient, serviceId, 'services', parsedStars);
        if (!svcRating) {
          const err = new Error('Failed to update service rating');
          err.statusCode = 500;
          await dbClient.query('ROLLBACK');
          return next(err);
        }
        const svcAvg = svcRating.count > 0
          ? parseFloat((svcRating.rate_sum / svcRating.count).toFixed(1)) : 0;
        await dbClient.query('UPDATE services SET avg_rating = $1 WHERE id = $2;', [svcAvg, serviceId]);
      }
    }

    const insertResult = await dbClient.query(
      `INSERT INTO review (creator_id, target_id, service_id, review, stars)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *;`,
      [creator_id, finalTargetId, serviceId, review ? review.trim() : '', parsedStars]
    );

    await dbClient.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Review created successfully',
      review: insertResult.rows[0]
    });
  } catch (error) {
    await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    dbClient.release();
  }
};

const getReviewByTargetId = async (req, res, next) => {
  const { targetId } = req.params;

  try {
    // Determine if targetId is a service or a user
    const svcCheck = await pool.query('SELECT 1 FROM services WHERE id = $1', [targetId]);

    let query;
    if (svcCheck.rows.length > 0) {
      // Get reviews by service_id
      query = `
        SELECT r.*,
               u.full_name AS creator_name,
               u.email AS creator_email,
               u.avatar_url AS creator_avatar
        FROM review r
        JOIN users u ON r.creator_id = u.id
        WHERE r.service_id = $1
        ORDER BY r.created_at DESC;
      `;
    } else {
      // Get reviews by target user ID (original behavior)
      query = `
        SELECT r.*,
               u.full_name AS creator_name,
               u.email AS creator_email,
               u.avatar_url AS creator_avatar
        FROM review r
        JOIN users u ON r.creator_id = u.id
        WHERE r.target_id = $1
        ORDER BY r.created_at DESC;
      `;
    }

    const result = await pool.query(query, [targetId]);

    let avgStars = null;
    const starRatings = result.rows.filter(r => r.stars !== null);
    if (starRatings.length > 0) {
      const sum = starRatings.reduce((acc, r) => acc + r.stars, 0);
      avgStars = parseFloat((sum / starRatings.length).toFixed(1));
    }

    return res.status(200).json({
      success: true,
      reviews: result.rows,
      avg_stars: avgStars,
      total_reviews: result.rows.length
    });
  } catch (error) {
    return next(error);
  }
};

const checkCanReview = async (req, res, next) => {
  const userId = req.user.id;
  const { serviceId } = req.params;

  try {
    // Check if target is a service
    const svcRes = await pool.query('SELECT expert_id FROM services WHERE id = $1', [serviceId]);

    let targetUserId;
    if (svcRes.rows.length > 0) {
      targetUserId = svcRes.rows[0].expert_id;
    } else {
      targetUserId = serviceId;
    }

    if (targetUserId === userId) {
      return res.status(200).json({ success: true, canReview: false, hasReviewed: false });
    }

    const dupCheck = await pool.query(
      'SELECT 1 FROM review WHERE creator_id = $1 AND target_id = $2',
      [userId, targetUserId]
    );
    const hasReviewed = dupCheck.rows.length > 0;

    const completed = await hasCompletedProject(userId, targetUserId);

    return res.status(200).json({
      success: true,
      canReview: completed && !hasReviewed,
      hasReviewed
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createReview,
  getReviewByTargetId,
  checkCanReview
};
