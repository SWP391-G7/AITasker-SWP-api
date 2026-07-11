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
    const sql = `
      SELECT t.*, p.title as project_title, uc.full_name as client_name, ue.full_name as expert_name
      FROM transactions t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN users uc ON t.sender_id = uc.id
      LEFT JOIN users ue ON t.receiver_id = ue.id
      WHERE t.receiver_id = $1 OR t.sender_id = $1
      ORDER BY t.complete_at DESC;
    `;
    const result = await pool.query(sql, [userId]);

    // 2. Fetch financial stats based on role
    let totalLifetime = 0;
    let availableNow = 0;
    let pendingClearance = 0;
    let inEscrow = 0;

    if (userRole === 'expert') {
      // Lifetime earnings = sum of completed transactions where receiver_id is expert
      const lifetimeRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE receiver_id = $1 AND status = 'completed';",
        [userId]
      );
      totalLifetime = parseFloat(lifetimeRes.rows[0].total || 0);

      // Available now = completed lifetime earnings (for this basic implementation, same as lifetime earnings)
      availableNow = totalLifetime;

      // Pending clearance = sum of pending transactions
      const pendingRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE receiver_id = $1 AND status = 'pending';",
        [userId]
      );
      pendingClearance = parseFloat(pendingRes.rows[0].total || 0);

      // In Escrow = sum of milestone amounts that are 'funded' or 'submitted' for expert's projects
      const escrowRes = await pool.query(
        `SELECT COALESCE(SUM(m.amount), 0) as total 
         FROM milestones m 
         JOIN projects p ON m.project_id = p.id 
         WHERE p.expert_id = $1 AND m.status IN ('funded', 'submitted');`,
        [userId]
      );
      inEscrow = parseFloat(escrowRes.rows[0].total || 0);
    } else if (userRole === 'client') {
      // Total spent = sum of completed transactions where sender_id is client
      const spentRes = await pool.query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE sender_id = $1 AND status = 'completed';",
        [userId]
      );
      totalLifetime = parseFloat(spentRes.rows[0].total || 0); // Reuse totalLifetime variable as total spent

      // In Escrow = sum of milestone amounts that are 'funded' or 'submitted' for client's projects
      const escrowRes = await pool.query(
        `SELECT COALESCE(SUM(m.amount), 0) as total 
         FROM milestones m 
         JOIN projects p ON m.project_id = p.id 
         WHERE p.client_id = $1 AND m.status IN ('funded', 'submitted');`,
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
