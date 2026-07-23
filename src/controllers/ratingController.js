const { pool } = require('../config/db');

/**
 * @desc    Rate a target (User or Service)
 * @route   POST /api/ratings
 * @access  Private
 */
const rateTarget = async (req, res, next) => {
  const { target_id, stars } = req.body;

  if (!target_id) {
    const err = new Error('Target ID is required');
    err.statusCode = 400;
    return next(err);
  }

  const parsedStars = parseInt(stars, 10);
  if (isNaN(parsedStars) || parsedStars < 1 || parsedStars > 5) {
    const err = new Error('Rating stars must be an integer between 1 and 5');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // 1. Identify target table (users or services) and retrieve current rating ID
    let targetTable = null;
    let currentRatingId = null;

    // Check users table
    const userCheck = await dbClient.query('SELECT rating FROM users WHERE id = $1', [target_id]);
    if (userCheck.rows.length > 0) {
      targetTable = 'users';
      currentRatingId = userCheck.rows[0].rating;
    } else {
      // Check services table
      const serviceCheck = await dbClient.query('SELECT rating FROM services WHERE id = $1', [target_id]);
      if (serviceCheck.rows.length > 0) {
        targetTable = 'services';
        currentRatingId = serviceCheck.rows[0].rating;
      }
    }

    if (!targetTable) {
      const err = new Error('Target (User or Service) not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // 2. Execute the rating flow
    let ratingId = currentRatingId;
    let ratingRecord;

    if (!ratingId) {
      // - If the rating id is null, create a new Rating object in Rating table
      const insertRatingRes = await dbClient.query(
        'INSERT INTO rating (rate_sum, count) VALUES ($1, $2) RETURNING *;',
        [parsedStars, 1]
      );
      ratingRecord = insertRatingRes.rows[0];
      ratingId = ratingRecord.id;

      // - and add that id to the id of the target (update target table's rating reference)
      await dbClient.query(
        `UPDATE ${targetTable} SET rating = $1 WHERE id = $2;`,
        [ratingId, target_id]
      );
    } else {
      // - if the rating id is not null, use that rating id to look for the Rating object in the Rating table.
      // - Increase the count variable 1 time. Add the number of the stars to the rate_sum.
      const updateRatingRes = await dbClient.query(
        `UPDATE rating 
         SET count = count + 1, rate_sum = rate_sum + $1 
         WHERE id = $2 
         RETURNING *;`,
        [parsedStars, ratingId]
      );
      ratingRecord = updateRatingRes.rows[0];
    }

    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Rating processed successfully',
      rating: ratingRecord
    });

  } catch (error) {
    await dbClient.query('ROLLBACK');
    return next(error);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Get rating details by ID
 * @route   GET /api/ratings/:id
 * @access  Public
 */
const getRatingById = async (req, res, next) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM rating WHERE id = $1;', [id]);
    
    if (result.rows.length === 0) {
      const err = new Error('Rating not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      rating: result.rows[0]
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * @desc    Get average rating by ID
 * @route   GET /api/ratings/:id/average
 * @access  Public
 */
const getAverageRating = async (req, res, next) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT rate_sum, count FROM rating WHERE id = $1;', [id]);
    
    if (result.rows.length === 0) {
      const err = new Error('Rating not found');
      err.statusCode = 404;
      return next(err);
    }

    const { rate_sum, count } = result.rows[0];
    const averageRating = count > 0 ? (rate_sum / count) : 0;

    return res.status(200).json({
      success: true,
      averageRating
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  rateTarget,
  getRatingById,
  getAverageRating
};

