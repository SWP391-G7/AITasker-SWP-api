const { query } = require('../config/db');
const { broadcast } = require('../config/wsClients');

/**
 * Creates a notification in the database and broadcasts it in real-time if the user is online.
 * @param {string} userId - Recipient user ID (UUID)
 * @param {object} param1 - Notification details { title, message, type, referenceId }
 * @returns {Promise<object>} The created notification object
 */
async function sendNotification(userId, { title, message, type, referenceId = null }) {
  try {
    if (!userId) {
      console.warn('[Notification Service] Cannot send notification: userId is undefined');
      return null;
    }

    // 1. Insert notification into PostgreSQL database
    const sql = `
      INSERT INTO notifications (user_id, title, message, type, reference_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const res = await query(sql, [userId, title, message, type, referenceId]);
    const notification = res.rows[0];

    // 2. Real-time broadcast via WebSocket if client is connected
    broadcast(userId, {
      type: 'NOTIFICATION_RECEIVED',
      payload: notification
    });

    console.log(`[Notification Service] Sent '${type}' notification to user ${userId}`);
    return notification;
  } catch (error) {
    console.error('[Notification Service] Error sending notification:', error);
    return null;
  }
}

module.exports = {
  sendNotification
};
