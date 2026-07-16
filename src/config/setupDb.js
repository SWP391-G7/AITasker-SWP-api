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

    // Ensure users table has avatar_url column
    console.log('Ensuring users table has "avatar_url" column...');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255) DEFAULT NULL;');
    console.log('Avatar URL column checked/added successfully.');

    // Ensure conversations table matches the participant-based schema (sender_id, target_id)
    console.log('Ensuring conversations table matches the participant-based schema...');
    await client.query('ALTER TABLE conversations DROP COLUMN IF EXISTS project_id;');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id) ON DELETE CASCADE;');
    await client.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS target_id UUID REFERENCES users(id) ON DELETE CASCADE;');
    console.log('Conversations table checked/migrated successfully.');

    // Ensure rating table exists
    console.log('Ensuring rating table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rating (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rate_sum INT DEFAULT 0,
        count INT DEFAULT 0
      );
    `);

    // Ensure rating column exists in users table
    console.log('Ensuring users table has "rating" column...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rating UUID REFERENCES rating(id) ON DELETE SET NULL DEFAULT NULL;
    `);

    // Ensure rating column exists in services table
    console.log('Ensuring services table has "rating" column...');
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS rating UUID REFERENCES rating(id) ON DELETE SET NULL DEFAULT NULL;
    `);

    console.log('Rating & Review tables and attributes checked/added successfully.');

    // Ensure notification_type enum exists
    console.log('Ensuring notification_type enum exists...');
    try {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
            CREATE TYPE notification_type AS ENUM (
              'new_proposal', 
              'counter_proposal', 
              'proposal_accepted', 
              'new_milestones', 
              'milestones_accepted', 
              'milestone_rejected', 
              'milestone_submitted', 
              'milestone_approved', 
              'milestones_finished', 
              'new_project', 
              'project_finished'
            );
          END IF;
        END
        $$;
      `);
      console.log('notification_type enum checked/created successfully.');
    } catch (err) {
      console.warn('Non-fatal warning creating notification_type enum:', err.message);
    }

    // Ensure notifications table exists
    console.log('Ensuring notifications table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type notification_type NOT NULL,
        reference_id UUID,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('notifications table checked/created successfully.');

    // Ensure search index exists
    console.log('Ensuring notifications index exists...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);
    `);
    console.log('notifications index checked/created successfully.');

    // Ensure client_profiles and expert_profiles have the new onboarding columns
    console.log('Ensuring client_profiles and expert_profiles have onboarding columns...');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);');
    await client.query('ALTER TABLE client_profiles ADD COLUMN IF NOT EXISTS industry VARCHAR(255);');
    
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS professional_title VARCHAR(255);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS experience VARCHAR(100);');
    await client.query('ALTER TABLE expert_profiles ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(255);');
    console.log('Onboarding columns checked/added successfully.');
    
    // Ensure job_status enum has all required values
    console.log('Ensuring job_status enum has required values (pending, closed, removed)...');
    const requiredJobStatuses = ['pending', 'closed', 'removed'];
    for (const val of requiredJobStatuses) {
      try {
        await client.query(`ALTER TYPE job_status ADD VALUE IF NOT EXISTS '${val}';`);
      } catch (err) {
        if (err.code !== '42710' && err.code !== '42704') {
          console.warn(`Non-fatal warning adding '${val}' to job_status enum:`, err.message);
        }
      }
    }
    console.log('job_status enum values checked/added successfully.');

    // Add counter-proposal columns to proposals table
    console.log('Ensuring proposals table has counter-proposal columns...');
    await client.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_bid_amount NUMERIC(10, 2);');
    await client.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_cover_letter TEXT;');
    await client.query('ALTER TABLE proposals ADD COLUMN IF NOT EXISTS counter_initiated_by UUID;');
    console.log('Counter-proposal columns checked/added successfully.');

    // Add countered status to proposal_status enum
    console.log('Ensuring proposal_status enum has "countered" status...');
    try {
      await client.query("ALTER TYPE proposal_status ADD VALUE 'countered';");
      console.log('Added countered status to proposal_status enum.');
    } catch (err) {
      if (err.code !== '42710') {
        console.warn('Non-fatal warning adding countered status to proposal_status enum:', err.message);
      } else {
        console.log('Countered status already exists in proposal_status enum.');
      }
    }

    // Add title and description to projects table
    console.log('Ensuring projects table has title and description columns...');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS title VARCHAR(255);');
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;');
    console.log('Projects table columns checked/added successfully.');

    // Add requirements column to job_posts
    console.log('Ensuring job_posts has requirements column...');
    await client.query('ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS requirements TEXT;');
    console.log('Requirements column checked/added successfully.');

    // Add tags, images and video_link columns to job_posts
    console.log('Ensuring job_posts has tags and media columns...');
    await client.query('ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS tags TEXT;');
    await client.query('ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS images TEXT;');
    await client.query('ALTER TABLE job_posts ADD COLUMN IF NOT EXISTS video_link VARCHAR(255);');
    console.log('Tags and media columns checked/added successfully.');

    // Remove deprecated deadline column from job_posts (replaced by duration_days)
    console.log('Removing deprecated deadline column from job_posts if present...');
    await client.query('ALTER TABLE job_posts DROP COLUMN IF EXISTS deadline;');
    console.log('Deadline column check/removal done.');

    // Add milestone lifecycle columns
    console.log('Adding milestone lifecycle columns...');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS delivery_days INTEGER;');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deadline TIMESTAMP;');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS change_request_note TEXT;');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deliverable_url TEXT;');
    await client.query('ALTER TABLE milestones ADD COLUMN IF NOT EXISTS deliverable_note TEXT;');
    console.log('Milestone lifecycle columns added.');

    // Add new project_status enum values
    const newProjectStatuses = ['Planning', 'On-going', 'Completed'];
    console.log('Adding new project status enum values...');
    for (const val of newProjectStatuses) {
      try {
        await client.query(`ALTER TYPE project_status ADD VALUE IF NOT EXISTS '${val}';`);
      } catch (err) {
        if (err.code !== '42710' && err.code !== '42704') {
          console.warn(`Non-fatal: could not add project_status value '${val}':`, err.message);
        }
      }
    }

    // Add new milestone_status enum values
    const newMilestoneStatuses = [
      'planning', 'change_requested', 'planned', 'ongoing',
      'submitted', 'revision_requested', 'pending_payment', 'finished',
      'Pending', 'Approved', 'Declined', 'Wait for payment', 'Finished'
    ];
    console.log('Adding new milestone status enum values...');
    for (const val of newMilestoneStatuses) {
      try {
        await client.query(`ALTER TYPE milestone_status ADD VALUE IF NOT EXISTS '${val}';`);
      } catch (err) {
        if (err.code !== '42710' && err.code !== '42704') {
          console.warn(`Non-fatal: could not add milestone_status value '${val}':`, err.message);
        }
      }
    }
    console.log('Milestone status enum values checked/added.');

    // Ensure invitations table has columns for the service request flow
    console.log('Ensuring invitations table has service request columns...');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS cover_letter TEXT;');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS bid_amount NUMERIC(10, 2);');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS delivery_days INT;');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS status proposal_status DEFAULT \'pending\';');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS counter_bid_amount NUMERIC(10, 2);');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS counter_delivery_days INTEGER;');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS counter_cover_letter TEXT;');
    await client.query('ALTER TABLE invitations ADD COLUMN IF NOT EXISTS counter_initiated_by UUID;');
    console.log('Invitations table columns checked/added successfully.');
    // Ensure users table has acc_status column
    console.log('Ensuring users table has "acc_status" column...');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS acc_status BOOLEAN DEFAULT true;');

    // Ensure services table has status column
    console.log('Ensuring services table has "status" column...');
    await client.query("ALTER TABLE services ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';");

    // (Covered by requiredJobStatuses loop above)


    // Add new notification types to notification_type enum if they don't exist
    const newNotifTypes = ['new_service_request', 'counter_service_request', 'service_request_accepted'];
    for (const val of newNotifTypes) {
      try {
        await client.query(`ALTER TYPE notification_type ADD VALUE '${val}';`);
      } catch (err) {
        if (err.code !== '42710') {
          console.warn(`Non-fatal warning adding ${val} to notification_type enum:`, err.message);
        }
      }
    }
    // Drop old reviews table and its custom enum type
    console.log('Removing old reviews table and review_direction enum type if they exist...');
    await client.query('DROP TABLE IF EXISTS reviews CASCADE;');
    await client.query('DROP TYPE IF EXISTS review_direction CASCADE;');

    // Ensure rating table exists
    console.log('Ensuring rating table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rating (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        rate_sum INT DEFAULT 0,
        count INT DEFAULT 0
      );
    `);

    // Ensure review table exists (singular)
    console.log('Ensuring review table exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS review (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        creator_id UUID REFERENCES users(id) ON DELETE CASCADE,
        target_id UUID REFERENCES users(id) ON DELETE CASCADE,
        review TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure rating column exists in users table
    console.log('Ensuring users table has "rating" column...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS rating UUID REFERENCES rating(id) ON DELETE SET NULL DEFAULT NULL;
    `);

    // Ensure rating column exists in services table
    console.log('Ensuring services table has "rating" column...');
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS rating UUID REFERENCES rating(id) ON DELETE SET NULL DEFAULT NULL;
    `);

    // Ensure images and video_link columns exist in services table
    console.log('Ensuring services table has "images" and "video_link" columns...');
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS images TEXT;
    `);
    await client.query(`
      ALTER TABLE services ADD COLUMN IF NOT EXISTS video_link VARCHAR(255);
    `);
    console.log('Rating & Review tables and attributes checked/added successfully.');

  } catch (err) {
    console.error('Error during database initialization:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initDatabase };
