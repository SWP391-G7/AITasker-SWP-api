const app = require('./app');
const { testConnection } = require('./config/db');
const { initDatabase } = require('./config/setupDb');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    console.log('Starting AITasker Backend API...');
    
    // 1. Verify connection to PostgreSQL
    await testConnection();
    
    // 2. Setup schema and tables from schema.sql
    await initDatabase();
    
    // 3. Start listening for requests
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(`🚀 Server successfully running on port ${PORT}`);
      console.log(`👉 Health check: http://localhost:${PORT}/api/health`);
      console.log(`👉 Auth endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`===============================================`);
    });
    
  } catch (err) {
    console.error('Fatal Error during startup, shutting down:', err.message);
    process.exit(1);
  }
}

// Start the backend server lifecycle
startServer();
