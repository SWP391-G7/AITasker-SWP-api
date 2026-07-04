const { pool } = require('../config/db');

/**
 * @desc    Get all conversations for the authenticated user
 * @route   GET /api/conversations
 * @access  Private
 */
const getConversations = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const queryText = `
      WITH last_messages AS (
          SELECT DISTINCT ON (conversation_id) 
              conversation_id, 
              content, 
              send_at
          FROM messages
          ORDER BY conversation_id, send_at DESC
      ),
      unread_counts AS (
          SELECT 
              conversation_id, 
              COUNT(*) AS unread_count
          FROM messages
          WHERE user_id != $1 AND is_read = false
          GROUP BY conversation_id
      )
      SELECT 
          c.id,
          c.sender_id,
          c.target_id,
          c.content,
          c.created_at,
          other_u.id AS other_user_id,
          other_u.full_name AS other_user_name,
          other_u.email AS other_user_email,
          other_u.role AS other_user_role,
          ep.professional_title AS other_user_professional_title,
          cp.company_name AS other_user_company_name,
          COALESCE(lm.content, '') AS last_message,
          lm.send_at AS last_message_time,
          COALESCE(uc.unread_count, 0)::int AS unread
      FROM conversations c
      INNER JOIN users other_u ON (
          (c.sender_id = $1 AND c.target_id = other_u.id) OR
          (c.target_id = $1 AND c.sender_id = other_u.id)
      )
      LEFT JOIN expert_profiles ep ON other_u.id = ep.id
      LEFT JOIN client_profiles cp ON other_u.id = cp.id
      LEFT JOIN last_messages lm ON c.id = lm.conversation_id
      LEFT JOIN unread_counts uc ON c.id = uc.conversation_id
      WHERE c.sender_id = $1 OR c.target_id = $1
      ORDER BY COALESCE(lm.send_at, c.created_at) DESC;
    `;

    const result = await pool.query(queryText, [userId]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get or create a conversation with a specific user
 * @route   POST /api/conversations
 * @access  Private
 */
const getOrCreateConversation = async (req, res, next) => {
  const senderId = req.user.id;
  const { targetId } = req.body;

  if (!targetId) {
    const err = new Error('Target user ID is required');
    err.statusCode = 400;
    return next(err);
  }

  if (senderId === targetId) {
    const err = new Error('You cannot start a conversation with yourself');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // 1. Verify target user exists
    const userCheck = await pool.query('SELECT full_name, role FROM users WHERE id = $1', [targetId]);
    if (userCheck.rows.length === 0) {
      const err = new Error('Target user not found');
      err.statusCode = 404;
      return next(err);
    }
    const targetUser = userCheck.rows[0];

    // 2. Check if conversation already exists
    const existingCheck = await pool.query(
      `SELECT id, sender_id, target_id, content, created_at 
       FROM conversations 
       WHERE (sender_id = $1 AND target_id = $2) 
          OR (sender_id = $2 AND target_id = $1)`,
      [senderId, targetId]
    );

    if (existingCheck.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Conversation already exists',
        data: existingCheck.rows[0]
      });
    }

    // 3. Create new conversation
    const content = `Chat between ${req.user.role} and ${targetUser.role}`;
    const insertQuery = `
      INSERT INTO conversations (sender_id, target_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, sender_id, target_id, content, created_at;
    `;
    const newConv = await pool.query(insertQuery, [senderId, targetId, content]);

    return res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      data: newConv.rows[0]
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get all messages for a specific conversation
 * @route   GET /api/conversations/:id/messages
 * @access  Private
 */
const getConversationMessages = async (req, res, next) => {
  const conversationId = req.params.id;
  const userId = req.user.id;

  try {
    // 1. Verify conversation exists and user is a participant
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

    // 2. Mark unread messages sent by the other user as read
    await pool.query(
      `UPDATE messages 
       SET is_read = true 
       WHERE conversation_id = $1 AND user_id != $2 AND is_read = false`,
      [conversationId, userId]
    );

    // 3. Fetch all messages in the conversation
    const messagesQuery = `
      SELECT 
          m.id,
          m.user_id,
          m.conversation_id,
          m.content,
          m.attachments,
          m.is_read,
          m.send_at,
          u.full_name AS sender_name,
          u.role AS sender_role
      FROM messages m
      INNER JOIN users u ON m.user_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.send_at ASC;
    `;
    const messagesResult = await pool.query(messagesQuery, [conversationId]);

    return res.status(200).json({
      success: true,
      data: messagesResult.rows
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getConversations,
  getOrCreateConversation,
  getConversationMessages
};
