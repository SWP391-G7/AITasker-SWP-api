/**
 * Backend module: config/wsClients.js
 *
 * Vai trò: Cấu hình ws Clients: khởi tạo kết nối hoặc tài nguyên hạ tầng dùng chung của backend.
 * Luồng chính: Đọc biến môi trường, tạo client/pool và export instance cho controller hoặc utility tái sử dụng.
 * Lưu ý bảo trì: Không hard-code secret; mọi credential phải lấy từ environment.
 */
/**
 * wsClients.js
 * Shared singleton that holds the WebSocket client registry.
 * Exported so both server.js (which writes to it) and
 * messageController.js (which reads/broadcasts) can import it.
 */

/** @type {Map<string, import('ws').WebSocket>} userId → WebSocket */
const clients = new Map();

/**
 * Send a JSON payload to a specific user if they are connected.
 * @param {string} userId
 * @param {object} payload
 */
function broadcast(userId, payload) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === 1 /* OPEN */) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      console.error('[WS] Failed to broadcast to', userId, e.message);
    }
  }
}

module.exports = { clients, broadcast };
