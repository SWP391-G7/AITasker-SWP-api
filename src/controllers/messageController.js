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

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createMessage
};
