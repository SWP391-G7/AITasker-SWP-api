const { query } = require('../config/db');

/**
 * Get all notifications for the authenticated user
 */
async function getNotifications(req, res, next) {
  try {
    const userId = req.user.id;

    // Auto-delete already-read notifications from DB on page load
    const deleteSql = `
      DELETE FROM notifications 
      WHERE user_id = $1 AND is_read = true;
    `;
    await query(deleteSql, [userId]);

    const sql = `
      SELECT * FROM notifications 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 100;
    `;
    const result = await query(sql, [userId]);
    
    // Count unread notifications
    const countSql = `
      SELECT COUNT(*) as unread_count 
      FROM notifications 
      WHERE user_id = $1 AND is_read = false;
    `;
    const countResult = await query(countSql, [userId]);
    const unreadCount = parseInt(countResult.rows[0].unread_count || 0, 10);

    return res.status(200).json({
      success: true,
      notifications: result.rows,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark a specific notification as read
 */
async function markAsRead(req, res, next) {
  try {
    const userId = req.user.id;
    const notificationId = req.params.id;

    // Verify ownership and update status
    const sql = `
      UPDATE notifications 
      SET is_read = true 
      WHERE id = $1 AND user_id = $2 
      RETURNING *;
    `;
    const result = await query(sql, [notificationId, userId]);

    if (result.rows.length === 0) {
      const error = new Error('Notification not found or not authorized');
      error.statusCode = 404;
      throw error;
    }

    return res.status(200).json({
      success: true,
      notification: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark all notifications as read for the authenticated user
 */
async function markAllAsRead(req, res, next) {
  try {
    const userId = req.user.id;

    const sql = `
      UPDATE notifications 
      SET is_read = true 
      WHERE user_id = $1 
      RETURNING *;
    `;
    const result = await query(sql, [userId]);

    return res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      count: result.rows.length
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead
};
