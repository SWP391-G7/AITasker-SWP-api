const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

/**
 * Checks if the users table exists in the current database
 */
async function checkTableExists(tableName) {
  const queryText = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = $1
    );
  `;
  const res = await pool.query(queryText, [tableName]);
  return res.rows[0].exists;
}

/**
 * Initializes the database schema using the schema.sql file
 */
async function initDatabase() {
  console.log('Verifying database schema status...');
  const client = await pool.connect();
  
  try {
    const usersTableExists = await checkTableExists('users');
    
    if (!usersTableExists) {
      console.log('Database not initialized. Reading schema.sql...');
      const schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
      
      if (!fs.existsSync(schemaPath)) {
        throw new Error(`schema.sql not found at path: ${schemaPath}`);
      }
      
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      console.log('Executing schema.sql queries...');
      // Execute the entire multi-statement schema file
      await client.query(schemaSql);
      console.log('Database schema successfully initialized from schema.sql!');
    } else {
      console.log('Tables already exist. Skipping schema.sql execution.');
    }
    
    // Add password column to the users table if it does not already exist
    console.log('Ensuring users table has "password" column for authentication...');
    const alterQuery = 'ALTER TABLE users ADD COLUMN IF NOT EXISTS password VARCHAR(255);';
    await client.query(alterQuery);
    console.log('Password column checked/added successfully.');
    
  } catch (err) {
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDatabase };
