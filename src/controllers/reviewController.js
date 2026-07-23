/**
 * Backend module: controllers/reviewController.js
 *
 * Vai trò: Controller review Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
const { pool } = require('../config/db');

/**
 * @desc    Create a review (User reviewing User)
 * @route   POST /api/reviews
 * @access  Private
 */
const createReview = async (req, res, next) => {
  const creator_id = req.user.id;
  const { target_id, review } = req.body;

  if (!target_id) {
    const err = new Error('Target ID is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    let finalTargetId = target_id;

    // Check if target is a service, in which case we review the expert who owns it
    const serviceCheck = await pool.query('SELECT expert_id FROM services WHERE id = $1', [target_id]);
    if (serviceCheck.rows.length > 0) {
      finalTargetId = serviceCheck.rows[0].expert_id;
    }

    // Verify target exists in users table (since review table target_id references users)
    const userCheck = await pool.query('SELECT 1 FROM users WHERE id = $1', [finalTargetId]);
    if (userCheck.rows.length === 0) {
      const err = new Error('Target user not found');
      err.statusCode = 404;
      return next(err);
    }

    // Insert Review object in Review table
    const insertQuery = `
      INSERT INTO review (creator_id, target_id, review) 
      VALUES ($1, $2, $3) 
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [
      creator_id,
      finalTargetId,
      review ? review.trim() : ''
    ]);

    return res.status(201).json({
      success: true,
      message: 'Review created successfully',
      review: result.rows[0]
    });

  } catch (error) {
    return next(error);
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

module.exports = {
  createReview,
  getReviewByTargetId
};
