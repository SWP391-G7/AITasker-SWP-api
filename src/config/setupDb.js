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

    // Ensure client_profiles and expert_profiles have the new onboarding columns
    console.log('Ensuring client_profiles and expert_profiles have onboarding columns...');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS industry VARCHAR(255);');
    
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS professional_title VARCHAR(255);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS experience VARCHAR(100);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(255);');
    console.log('Onboarding columns checked/added successfully.');
    
    // Add pending status to job_status enum
    console.log('Ensuring job_status enum has "pending" status...');
    try {
      await client.query("ALTER TYPE job_status ADD VALUE 'pending';");
      console.log('Added pending status to job_status enum.');
    } catch (err) {
      if (err.code !== '42710') {
        console.warn('Non-fatal warning adding pending status to job_status enum:', err.message);
      } else {
        console.log('Pending status already exists in job_status enum.');
      }
    }

    // Add closed status to job_status enum
    console.log('Ensuring job_status enum has "closed" status...');
    try {
      await client.query("ALTER TYPE job_status ADD VALUE 'closed';");
      console.log('Added closed status to job_status enum.');
    } catch (err) {
      if (err.code !== '42710') {
        console.warn('Non-fatal warning adding closed status to job_status enum:', err.message);
      } else {
        console.log('Closed status already exists in job_status enum.');
      }
    }

    // Add title and description to projects table
    console.log('Ensuring projects table has title and description columns...');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS title VARCHAR(255);');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;');
    console.log('Projects table columns checked/added successfully.');

  } catch (err) {
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDatabase };
