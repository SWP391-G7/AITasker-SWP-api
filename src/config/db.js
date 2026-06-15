const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// Allow connection using either a full DATABASE_URL connection string or individual environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : (process.env.DB_HOST || 'localhost'),
  port: process.env.DATABASE_URL ? undefined : (process.env.DB_PORT || 5432),
  user: process.env.DATABASE_URL ? undefined : (process.env.DB_USER || 'postgres'),
  password: process.env.DATABASE_URL ? undefined : (process.env.DB_PASSWORD || 'postgres'),
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME || 'aitasker'),
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Log pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

module.exports = {
  pool,
  /**
   * Helper query function to execute queries
   * @param {string} text - SQL query text
   * @param {Array} params - Query parameters
   */
  query: (text, params) => pool.query(text, params),
  
  /**
   * Verification function to test db connection
   */
  testConnection: async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT NOW()');
      console.log('PostgreSQL Database connected successfully at:', res.rows[0].now);
      return true;
    } catch (err) {
      console.error('PostgreSQL Connection Failure:', err.message);
      throw err;
    } finally {
      client.release();
    }
  }
};
