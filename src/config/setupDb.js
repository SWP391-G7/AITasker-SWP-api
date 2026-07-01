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

    // Add acc_status column for admin account activation/deactivation if it does not already exist
    console.log('Ensuring users table has "acc_status" column for admin account status...');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS acc_status BOOLEAN DEFAULT true;');
    console.log('Account status column checked/added successfully.');

    // Ensure client_profiles and expert_profiles have the new onboarding columns
    console.log('Ensuring client_profiles and expert_profiles have onboarding columns...');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS industry VARCHAR(255);');
    
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS professional_title VARCHAR(255);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS experience VARCHAR(100);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(255);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS skills TEXT;');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS hourly_rate VARCHAR(50);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS bio TEXT;');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS ai_specializations TEXT;');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS avg_rating REAL DEFAULT 0.0;');
    console.log('Onboarding columns checked/added successfully.');
    
  } catch (err) {
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDatabase };
