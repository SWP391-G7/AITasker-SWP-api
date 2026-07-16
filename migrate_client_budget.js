const { pool } = require('./src/config/db');

async function migrate() {
  console.log('Running client budget migration...');
  await pool.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS budget NUMERIC(10, 2) DEFAULT 10000.00;');
  await pool.query('UPDATE client_profiles SET budget = 10000.00 WHERE budget IS NULL;');
  console.log('Migration of client budget completed successfully.');
}

migrate()
  .catch(console.error)
  .finally(() => pool.end());
