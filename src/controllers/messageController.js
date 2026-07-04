const { pool } = require('../config/db');

/**
 * @desc    Send a message in a conversation
 * @route   POST /api/messages
 * @access  Private
 */
const createMessage = async (req, res, next) => {
  const userId = req.user.id;
  const { conversationId, content, attachments } = req.body;

  if (!conversationId) {
    const err = new Error('Conversation ID is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!content && !attachments) {
    const err = new Error('Message content or attachments is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // 1. Verify conversation exists and user is participant
    const convCheck = await pool.query(
      'SELECT sender_id, target_id FROM conversations WHERE id = $1',
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      const err = new Error('Conversation not found');
      err.statusCode = 404;
      return next(err);
    }

    const { sender_id, target_id } = convCheck.rows[0];
    if (sender_id !== userId && target_id !== userId) {
      const err = new Error('Forbidden: You are not a participant in this conversation');
      err.statusCode = 403;
      return next(err);
    }

    // 2. Insert new message
    const insertQuery = `
      INSERT INTO messages (user_id, conversation_id, content, attachments, is_read)
      VALUES ($1, $2, $3, $4, false)
      RETURNING id, user_id, conversation_id, content, attachments, is_read, send_at;
    `;
    const messageRes = await pool.query(insertQuery, [
      userId,
      conversationId,
      content || null,
      attachments || null
    ]);

    const newMessage = messageRes.rows[0];

    // Fetch sender's name for WS payload
    const senderRes = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
    const senderName = senderRes.rows[0]?.full_name || 'User';

    const msgPayload = {
      ...newMessage,
      sender_name: senderName
    };

    // 3. Broadcast message to other participant if online
    const otherUserId = sender_id === userId ? target_id : sender_id;
    const { broadcast } = require('../config/wsClients');
    broadcast(otherUserId, {
      type: 'new_message',
      conversationId,
      message: msgPayload
    });

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: msgPayload
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createMessage
};
