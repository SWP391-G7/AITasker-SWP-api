const app = require('./app')
const { testConnection } = require('./config/db')
const { initDatabase } = require('./config/setupDb')
const { initializeEmailService } = require('./utils/emailService')
require('dotenv').config()

const PORT = process.env.PORT || 5000

async function startServer() {
  try {
    console.log('Starting AITasker Backend API...')

    // 1. Verify connection to PostgreSQL
    await testConnection()

    // 2. Setup schema and tables from schema.sql
    await initDatabase()

    // 3. Initialize email service
    await initializeEmailService()
    console.log('Email service initialized successfully')

    // 4. Start listening for requests with WebSocket support
    const http = require('http');
    const WebSocket = require('ws');
    const { verifyToken } = require('./utils/token');
    const { clients } = require('./config/wsClients');

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        const token = url.searchParams.get('token');
        
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const decoded = verifyToken(token);
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.userId = decoded.id;
          wss.emit('connection', ws, request);
        });
      } catch (err) {
        console.error('[WS Upgrade Error]', err.message);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    wss.on('connection', (ws) => {
      const userId = ws.userId;
      console.log(`[WS] Client connected: ${userId}`);
      clients.set(userId, ws);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          // ignore parsing error
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${userId}`);
        if (clients.get(userId) === ws) {
          clients.delete(userId);
        }
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error: ${userId}`, err.message);
        if (clients.get(userId) === ws) {
          clients.delete(userId);
        }
      });
    });

    server.listen(PORT, () => {
      console.log(`===============================================`)
      console.log(`Server successfully running on port ${PORT} with WebSockets`)
      console.log(`Health check: http://localhost:${PORT}/api/health`)
      console.log(`Auth endpoints: http://localhost:${PORT}/api/auth`)
      console.log(`SwaggerUI api check: http://localhost:${PORT}/api-docs`)
      console.log(`===============================================`)
    });

  } catch (err) {
    console.error('Fatal Error during startup, shutting down:', err.message)
    process.exit(1)
  }
}

// Start the backend server lifecycle
startServer()

