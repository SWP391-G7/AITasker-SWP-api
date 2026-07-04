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
