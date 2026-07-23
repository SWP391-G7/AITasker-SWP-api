const test = require('node:test');
const assert = require('node:assert');
const { pool } = require('./src/config/db');
const { initDatabase } = require('./src/config/setupDb');
const { createMessage, removeMessage } = require('./src/controllers/messageController');
const { getConversationMessages, getConversations } = require('./src/controllers/conversationController');

test('Message Removal Unit & Flow Test', async () => {
  // Ensure DB initialized
  await initDatabase();

  // 1. Setup test users and conversation in database
  const user1Res = await pool.query(
    `INSERT INTO users (full_name, email, password, role, is_verified) 
     VALUES ('Test User 1', 'testuser1_msg@example.com', 'hash', 'client', true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id;`
  );
  const user2Res = await pool.query(
    `INSERT INTO users (full_name, email, password, role, is_verified) 
     VALUES ('Test User 2', 'testuser2_msg@example.com', 'hash', 'expert', true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id;`
  );
  const user3Res = await pool.query(
    `INSERT INTO users (full_name, email, password, role, is_verified) 
     VALUES ('Test User 3 (Unauthorized)', 'testuser3_msg@example.com', 'hash', 'client', true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id;`
  );
  const adminRes = await pool.query(
    `INSERT INTO users (full_name, email, password, role, is_verified) 
     VALUES ('Test Admin', 'admin_msg@example.com', 'hash', 'admin', true)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id;`
  );

  const userId1 = user1Res.rows[0].id;
  const userId2 = user2Res.rows[0].id;
  const userId3 = user3Res.rows[0].id;
  const adminId = adminRes.rows[0].id;

  const convRes = await pool.query(
    `INSERT INTO conversations (sender_id, target_id, content) 
     VALUES ($1, $2, 'Test conversation for message remove') 
     RETURNING id;`,
    [userId1, userId2]
  );
  const conversationId = convRes.rows[0].id;

  // 2. Insert a test message from user1
  const originalText = 'Super Secret Message To Be Removed';
  const msgRes = await pool.query(
    `INSERT INTO messages (user_id, conversation_id, content, is_read) 
     VALUES ($1, $2, $3, false) 
     RETURNING id, content, is_removed;`,
    [userId1, conversationId, originalText]
  );
  const messageId = msgRes.rows[0].id;

  assert.strictEqual(msgRes.rows[0].is_removed, false);

  // 3. Test unauthorized user trying to remove message
  let unauthorizedError = null;
  const reqUnauth = {
    user: { id: userId3, role: 'client' },
    params: { id: messageId }
  };
  const resUnauth = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { this.body = data; return this; }
  };
  await removeMessage(reqUnauth, resUnauth, (err) => { unauthorizedError = err; });

  assert.notStrictEqual(unauthorizedError, null);
  assert.strictEqual(unauthorizedError.statusCode, 403);

  // 4. Test authorized user (user1) removing message
  const reqAuth = {
    user: { id: userId1, role: 'client' },
    params: { id: messageId }
  };
  let authResult = null;
  const resAuth = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { authResult = data; return this; }
  };
  await removeMessage(reqAuth, resAuth, (err) => { if (err) throw err; });

  assert.strictEqual(resAuth.statusCode, 200);
  assert.strictEqual(authResult.success, true);
  assert.strictEqual(authResult.data.is_removed, true);
  assert.strictEqual(authResult.data.content, 'Message has been removed');

  // 5. Verify database row still contains original text (NOT deleted)
  const dbCheck = await pool.query('SELECT content, is_removed FROM messages WHERE id = $1', [messageId]);
  assert.strictEqual(dbCheck.rows[0].is_removed, true);
  assert.strictEqual(dbCheck.rows[0].content, originalText, 'Database must retain original message text!');

  // 6. Test GET /api/conversations/:id/messages as regular user (user2)
  const reqGetMsgUser = {
    user: { id: userId2, role: 'expert' },
    params: { id: conversationId }
  };
  let userMessagesResult = null;
  const resGetMsgUser = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { userMessagesResult = data; return this; }
  };
  await getConversationMessages(reqGetMsgUser, resGetMsgUser, (err) => { if (err) throw err; });

  const fetchedMsgForUser = userMessagesResult.data.find(m => m.id === messageId);
  assert.strictEqual(fetchedMsgForUser.is_removed, true);
  assert.strictEqual(fetchedMsgForUser.content, 'Message has been removed', 'Regular user must receive soft-deleted placeholder');

  // 7. Test GET /api/conversations/:id/messages as Admin (adminId)
  const reqGetMsgAdmin = {
    user: { id: adminId, role: 'admin' },
    params: { id: conversationId }
  };
  let adminMessagesResult = null;
  const resGetMsgAdmin = {
    status: function(code) { this.statusCode = code; return this; },
    json: function(data) { adminMessagesResult = data; return this; }
  };
  await getConversationMessages(reqGetMsgAdmin, resGetMsgAdmin, (err) => { if (err) throw err; });

  const fetchedMsgForAdmin = adminMessagesResult.data.find(m => m.id === messageId);
  assert.strictEqual(fetchedMsgForAdmin.is_removed, true);
  assert.strictEqual(fetchedMsgForAdmin.content, originalText, 'Admin must see original message text for investigation!');

  // Clean up test data
  await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
  await pool.query('DELETE FROM users WHERE email LIKE \'%_msg@example.com\'');

  console.log('All Message Removal Tests Passed Successfully!');
});
