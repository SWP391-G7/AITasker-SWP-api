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

/**
 * @desc    Soft-delete / remove a message (only sender or admin)
 * @route   DELETE /api/messages/:id
 * @access  Private
 */
const removeMessage = async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const messageId = req.params.id;

  try {
    // 1. Fetch message details and conversation
    const msgCheck = await pool.query(
      `SELECT m.id, m.user_id, m.conversation_id, m.is_removed, c.sender_id, c.target_id 
       FROM messages m
       INNER JOIN conversations c ON m.conversation_id = c.id
       WHERE m.id = $1`,
      [messageId]
    );

    if (msgCheck.rows.length === 0) {
      const err = new Error('Message not found');
      err.statusCode = 404;
      return next(err);
    }

    const { user_id, conversation_id, sender_id, target_id } = msgCheck.rows[0];

    // 2. Authorization check: must be sender or admin
    if (user_id !== userId && userRole !== 'admin') {
      const err = new Error('Forbidden: You can only remove your own messages');
      err.statusCode = 403;
      return next(err);
    }

    // 3. Mark message as removed (soft delete without deleting database row)
    const updateRes = await pool.query(
      `UPDATE messages 
       SET is_removed = true 
       WHERE id = $1 
       RETURNING id, user_id, conversation_id, is_removed, send_at;`,
      [messageId]
    );

    const updatedMessage = updateRes.rows[0];

    // 4. Broadcast message removal to conversation participants
    const otherUserId = sender_id === userId ? target_id : sender_id;
    const { broadcast } = require('../config/wsClients');
    broadcast(otherUserId, {
      type: 'message_removed',
      conversationId: conversation_id,
      messageId: messageId
    });
    broadcast(userId, {
      type: 'message_removed',
      conversationId: conversation_id,
      messageId: messageId
    });

    return res.status(200).json({
      success: true,
      message: 'Message removed successfully',
      data: {
        ...updatedMessage,
        content: 'Message has been removed'
      }
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createMessage,
  removeMessage
};

