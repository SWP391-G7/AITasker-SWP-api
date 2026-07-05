const { pool } = require('./src/config/db');
async function migrate() {
  await pool.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_bid_amount NUMERIC(10, 2);');
  await pool.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_cover_letter TEXT;');
  await pool.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_initiated_by UUID;');
  try {
    await pool.query("ALTER TYPE proposal_status ADD VALUE 'countered';");
    console.log('Added countered enum value');
  } catch(e) {
    if (e.code === '42710') console.log('countered already exists');
    else throw e;
  }
  console.log('Migration done.');
}
migrate().catch(console.error).finally(() => pool.end());
