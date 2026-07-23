/**
 * Backend module: controllers/transactionController.js
 *
 * Vai trò: Controller transaction Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
const { pool } = require('../config/db');

/**
 * @desc    Get transactions and financial statistics for the logged-in user
 * @route   GET /api/transactions
 * @access  Private
 */
const getMyTransactions = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // 1. Fetch transactions list
    const expertTypeFilter = userRole === 'expert' ? "AND t.type = 'escrow_release'" : '';
    const sql = `
      SELECT t.*, p.title as project_title, uc.full_name as client_name, ue.full_name as expert_name
      FROM transactions t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users uc ON t.sender_id = uc.id
      LEFT JOIN users ue ON t.receiver_id = ue.id
      WHERE (t.receiver_id = $1 OR t.sender_id = $1)
      ${expertTypeFilter}
      ORDER BY t.complete_at DESC;
    `;
    const result = await pool.query(sql, [userId]);

    // 2. Fetch financial stats based on role
    let totalLifetime = 0;
    let availableNow = 0;
    let pendingClearance = 0;
    let inEscrow = 0;

    if (userRole === 'expert') {
      // Only released escrow is earned. Deposits remain locked and must not be
      // presented as available expert income.
      const lifetimeRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE receiver_id = $1 AND type = 'escrow_release' AND status = 'completed';",
        [userId]
      );
      totalLifetime = parseFloat(lifetimeRes.rows[0].total || 0);

      // Available now = completed lifetime earnings (for this basic implementation, same as lifetime earnings)
      availableNow = totalLifetime;

      // Pending clearance = sum of pending transactions
      const pendingRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE receiver_id = $1 AND type = 'escrow_release' AND status = 'pending';",
        [userId]
      );
      pendingClearance = parseFloat(pendingRes.rows[0].total || 0);

      // In escrow is funded money minus amounts already released.
      const escrowRes = await pool.query(
         `SELECT GREATEST(
           COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_deposit' AND status = 'completed'), 0) -
           COALESCE(SUM(amount) FILTER (WHERE type IN ('escrow_release', 'refund') AND status = 'completed'), 0),
           0
         ) AS total
         FROM transactions WHERE receiver_id = $1;`,
        [userId]
      );
      inEscrow = parseFloat(escrowRes.rows[0].total || 0);
    } else if (userRole === 'client') {
      const balanceRes = await pool.query(
        'SELECT COALESCE(budget, 0) AS balance FROM client_profiles WHERE id = $1',
        [userId]
      );
      availableNow = parseFloat(balanceRes.rows[0]?.balance || 0);

      // Client spend is money released to experts, not the initial escrow
      // deposit (otherwise the same funds are counted twice).
      const spentRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE sender_id = $1 AND type = 'escrow_release' AND status = 'completed';",
        [userId]
      );
      totalLifetime = parseFloat(spentRes.rows[0].total || 0); // Reuse totalLifetime variable as total spent

      // Deposits minus releases/refunds remain locked in escrow, even before
      // the expert has created the milestone plan.
      const escrowRes = await pool.query(
        `SELECT GREATEST(
           COALESCE(SUM(amount) FILTER (WHERE type = 'escrow_deposit' AND status = 'completed'), 0) -
           COALESCE(SUM(amount) FILTER (WHERE type IN ('escrow_release', 'refund') AND status = 'completed'), 0),
           0
         ) AS total
         FROM transactions WHERE sender_id = $1;`,
        [userId]
      );
      inEscrow = parseFloat(escrowRes.rows[0].total || 0);
    }

    return res.status(200).json({
      success: true,
      transactions: result.rows,
      stats: {
        totalLifetime,
        availableNow,
        pendingClearance,
        inEscrow
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyTransactions
};
