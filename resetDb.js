const { pool } = require('./src/config/db');

async function resetDb() {
  const client = await pool.connect();
  try {
    console.log('Resetting public schema...');
    await client.query('DROP SCHEMA public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query('GRANT ALL ON SCHEMA public TO public;');
    console.log('Database public schema reset successfully!');
  } catch (err) {
    console.error('Error resetting database:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

resetDb();
