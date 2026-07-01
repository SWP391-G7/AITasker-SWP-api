const bcrypt = require('bcryptjs');
const { pool } = require('../../config/db');

// Only these roles are allowed by the database enum user_role.
// Keeping this list here lets the controller reject bad input before PostgreSQL throws an enum error.
const validRoles = ['client', 'expert', 'admin'];

// Basic email format validation for create/update requests.
// This does not guarantee the email exists; it only prevents obviously invalid strings.
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Route params are used directly in SQL parameters, so SQL injection is already prevented by pg.
// This UUID check is still useful because it returns a clean 400 response instead of a database cast error.
const isValidUuid = (id) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
};

// Frontend forms may send booleans as actual booleans or as strings like "true"/"false".
// This helper normalizes both formats and returns undefined when the value was not provided.
const parseBoolean = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (String(value).toLowerCase() === 'true') {
    return true;
  }

  if (String(value).toLowerCase() === 'false') {
    return false;
  }

  return undefined;
};

// Convert database snake_case fields into camelCase fields used by the frontend.
// The query joins both profile tables, so this also groups profile columns under expertProfile/clientProfile.
const normalizeUser = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  role: row.role,
  isVerified: row.is_verified,
  accStatus: row.acc_status,
  createdAt: row.created_at,
  expertProfile: row.role === 'expert' || row.professional_title || row.skills || row.experience
    ? {
        professionalTitle: row.professional_title,
        skills: row.skills,
        experience: row.experience,
        portfolioUrl: row.portfolio_url,
        hourlyRate: row.hourly_rate,
        bio: row.expert_bio,
        aiSpecializations: row.ai_specializations,
        avgRating: row.avg_rating
      }
    : null,
  clientProfile: row.role === 'client' || row.company_name || row.industry
    ? {
        companyName: row.company_name,
        industry: row.industry,
        bio: row.client_bio
      }
    : null
});

// Shared SELECT used by list/detail/create/update responses.
// users is the main table, while profiles are LEFT JOINed so admin can still see accounts
// that do not have a completed expert/client profile yet.
const userDetailSelect = `
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.role,
    u.is_verified,
    u.acc_status,
    u.created_at,
    e.professional_title,
    e.skills,
    e.experience,
    e.portfolio_url,
    e.hourly_rate,
    e.bio AS expert_bio,
    e.ai_specializations,
    e.avg_rating,
    c.company_name,
    c.industry,
    c.bio AS client_bio
  FROM users u
  LEFT JOIN expert_profiles e ON e.id = u.id
  LEFT JOIN client_profiles c ON c.id = u.id
`;

// Create the matching profile row when a user becomes client/expert.
// ON CONFLICT makes this safe to call multiple times during create and update.
const ensureProfileForRole = async (dbClient, userId, role) => {
  if (role === 'client') {
    await dbClient.query(
      'INSERT INTO client_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [userId]
    );
  }

  if (role === 'expert') {
    await dbClient.query(
      'INSERT INTO expert_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [userId]
    );
  }
};

// Update role-specific profile data if the request body contains it.
// COALESCE keeps the existing value when the frontend does not send a field.
const applyProfileUpdate = async (dbClient, userId, role, body) => {
  if (role === 'client') {
    const { companyName, industry, bio } = body;

    await dbClient.query(
      `
        INSERT INTO client_profiles (id, company_name, industry, bio)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id)
        DO UPDATE SET
          -- Keep old profile values when the admin only updates user-level fields.
          company_name = COALESCE(EXCLUDED.company_name, client_profiles.company_name),
          industry = COALESCE(EXCLUDED.industry, client_profiles.industry),
          bio = COALESCE(EXCLUDED.bio, client_profiles.bio)
      `,
      [
        userId,
        companyName ? companyName.trim() : null,
        industry ? industry.trim() : null,
        bio ? bio.trim() : null
      ]
    );
  }

  if (role === 'expert') {
    const {
      professionalTitle,
      skills,
      experience,
      portfolioUrl,
      hourlyRate,
      bio,
      aiSpecializations
    } = body;

    await dbClient.query(
      `
        INSERT INTO expert_profiles (
          id,
          professional_title,
          skills,
          experience,
          portfolio_url,
          hourly_rate,
          bio,
          ai_specializations
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id)
        DO UPDATE SET
          -- Keep old profile values when the admin only updates user-level fields.
          professional_title = COALESCE(EXCLUDED.professional_title, expert_profiles.professional_title),
          skills = COALESCE(EXCLUDED.skills, expert_profiles.skills),
          experience = COALESCE(EXCLUDED.experience, expert_profiles.experience),
          portfolio_url = COALESCE(EXCLUDED.portfolio_url, expert_profiles.portfolio_url),
          hourly_rate = COALESCE(EXCLUDED.hourly_rate, expert_profiles.hourly_rate),
          bio = COALESCE(EXCLUDED.bio, expert_profiles.bio),
          ai_specializations = COALESCE(EXCLUDED.ai_specializations, expert_profiles.ai_specializations)
      `,
      [
        userId,
        professionalTitle ? professionalTitle.trim() : null,
        skills ? skills.trim() : null,
        experience ? experience.trim() : null,
        portfolioUrl ? portfolioUrl.trim() : null,
        hourlyRate !== undefined && hourlyRate !== null ? String(hourlyRate).trim() : null,
        bio ? bio.trim() : null,
        aiSpecializations ? aiSpecializations.trim() : null
      ]
    );
  }
};

/**
 * @desc    Get all users for admin user management
 * @route   GET /api/admin/users
 * @access  Private/Admin
 */
const getUsers = async (req, res, next) => {
  const { query, role } = req.query;
  const accStatus = parseBoolean(req.query.accStatus ?? req.query.acc_status);
  const values = [];

  // Start with a neutral condition so optional filters can be appended with AND.
  // This keeps the query builder simple while still using parameterized values.
  let whereClause = 'WHERE 1=1';

  if (query && query.trim() !== '') {
    // Search across user identity fields and profile fields.
    // ILIKE makes the search case-insensitive in PostgreSQL.
    values.push(`%${query.trim()}%`);
    whereClause += ` AND (
      u.full_name ILIKE $${values.length}
      OR u.email ILIKE $${values.length}
      OR e.professional_title ILIKE $${values.length}
      OR e.skills ILIKE $${values.length}
      OR c.company_name ILIKE $${values.length}
      OR c.industry ILIKE $${values.length}
    )`;
  }

  if (role && validRoles.includes(role)) {
    // Ignore unknown role filters instead of passing invalid enum values into SQL.
    values.push(role);
    whereClause += ` AND u.role = $${values.length}`;
  }

  if (accStatus !== undefined) {
    // acc_status=true means the account can operate; false means the account is banned/deactivated.
    values.push(accStatus);
    whereClause += ` AND u.acc_status = $${values.length}`;
  }

  try {
    const usersRes = await pool.query(
      `
        ${userDetailSelect}
        ${whereClause}
        -- Newer accounts appear first; name is a secondary stable sort.
        ORDER BY u.created_at DESC, u.full_name ASC
      `,
      values
    );

    return res.status(200).json({
      success: true,
      count: usersRes.rows.length,
      users: usersRes.rows.map(normalizeUser)
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Get one user by ID
 * @route   GET /api/admin/users/:id
 * @access  Private/Admin
 */
const getUserById = async (req, res, next) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // Detail uses the same joined shape as the list endpoint so the frontend receives
    // a consistent user object whether it loads one row or many rows.
    const userRes = await pool.query(
      `
        ${userDetailSelect}
        WHERE u.id = $1
      `,
      [id]
    );

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      user: normalizeUser(userRes.rows[0])
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Create a user
 * @route   POST /api/admin/users
 * @access  Private/Admin
 */
const createUser = async (req, res, next) => {
  const {
    fullName,
    email,
    password,
    role,
    isVerified
  } = req.body;
  const accStatus = parseBoolean(req.body.accStatus ?? req.body.acc_status);
  const verifiedStatus = parseBoolean(isVerified);

  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    const err = new Error('Full name is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!email || !isValidEmail(email)) {
    const err = new Error('A valid email is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    const err = new Error('Password must be at least 6 characters long');
    err.statusCode = 400;
    return next(err);
  }

  if (!role || !validRoles.includes(role)) {
    const err = new Error('Role must be one of: client, expert, admin');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();

  try {
    // A transaction keeps users and profile rows in sync.
    // If profile creation fails, the user insert is rolled back too.
    await dbClient.query('BEGIN');

    const normalizedEmail = email.toLowerCase().trim();
    // Email is unique in the database, but checking first gives a clearer API error message.
    const existingUserRes = await dbClient.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (existingUserRes.rows.length > 0) {
      const err = new Error('Email is already in use');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // Never store raw passwords. bcrypt hashes the admin-provided initial password.
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRes = await dbClient.query(
      `
        INSERT INTO users (full_name, email, password, role, is_verified, acc_status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        fullName.trim(),
        normalizedEmail,
        hashedPassword,
        role,
        verifiedStatus !== undefined ? verifiedStatus : false,
        accStatus !== undefined ? accStatus : true
      ]
    );

    const userId = userRes.rows[0].id;
    // Create the role-specific profile row and then fill optional profile fields from the same request body.
    await ensureProfileForRole(dbClient, userId, role);
    await applyProfileUpdate(dbClient, userId, role, req.body);

    // Re-read the row using the shared SELECT so the response has the same shape as getUsers/getUserById.
    const createdUserRes = await dbClient.query(
      `
        ${userDetailSelect}
        WHERE u.id = $1
      `,
      [userId]
    );

    await dbClient.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: normalizeUser(createdUserRes.rows[0])
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Update a user by ID
 * @route   PUT /api/admin/users/:id
 * @access  Private/Admin
 */
const updateUser = async (req, res, next) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    return next(err);
  }

  const {
    fullName,
    email,
    role,
    isVerified,
    password
  } = req.body;
  const accStatus = parseBoolean(req.body.accStatus ?? req.body.acc_status);
  const verifiedStatus = parseBoolean(isVerified);

  if (email && !isValidEmail(email)) {
    const err = new Error('A valid email is required');
    err.statusCode = 400;
    return next(err);
  }

  if (role && !validRoles.includes(role)) {
    const err = new Error('Role must be one of: client, expert, admin');
    err.statusCode = 400;
    return next(err);
  }

  if (password && (typeof password !== 'string' || password.length < 6)) {
    const err = new Error('Password must be at least 6 characters long');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();

  try {
    // Update is transactional because it can touch users and one of the profile tables.
    // This avoids partial updates when one query succeeds and another query fails.
    await dbClient.query('BEGIN');

    // Load the existing role first. If the request does not include a new role,
    // profile updates should still target the user's current profile table.
    const existingUserRes = await dbClient.query(
      'SELECT id, role FROM users WHERE id = $1',
      [id]
    );

    if (existingUserRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      // Prevent two users from sharing the same email while allowing the current user to keep their email.
      const duplicateEmailRes = await dbClient.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [normalizedEmail, id]
      );

      if (duplicateEmailRes.rows.length > 0) {
        const err = new Error('Email is already in use');
        err.statusCode = 400;
        await dbClient.query('ROLLBACK');
        return next(err);
      }
    }

    const updateFields = [];
    const values = [];

    // Build a dynamic UPDATE so admins can edit only the fields they send.
    // Values are still parameterized, so this avoids SQL injection.
    const addUpdateField = (column, value) => {
      values.push(value);
      updateFields.push(`${column} = $${values.length}`);
    };

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim() === '') {
        const err = new Error('Full name cannot be empty');
        err.statusCode = 400;
        await dbClient.query('ROLLBACK');
        return next(err);
      }

      addUpdateField('full_name', fullName.trim());
    }

    if (email !== undefined) {
      addUpdateField('email', email.toLowerCase().trim());
    }

    if (role !== undefined) {
      addUpdateField('role', role);
    }

    if (verifiedStatus !== undefined) {
      addUpdateField('is_verified', verifiedStatus);
    }

    if (accStatus !== undefined) {
      addUpdateField('acc_status', accStatus);
    }

    if (password !== undefined) {
      // Password update is optional; if provided, store only the hash.
      const hashedPassword = await bcrypt.hash(password, 10);
      addUpdateField('password', hashedPassword);
    }

    if (updateFields.length > 0) {
      values.push(id);
      await dbClient.query(
        `
          UPDATE users
          SET ${updateFields.join(', ')}
          WHERE id = $${values.length}
        `,
        values
      );
    }

    const nextRole = role || existingUserRes.rows[0].role;
    // If role changed to client/expert, make sure the matching profile table has a row.
    // Existing old-role profile data is intentionally not deleted here to avoid accidental data loss.
    await ensureProfileForRole(dbClient, id, nextRole);
    await applyProfileUpdate(dbClient, id, nextRole, req.body);

    const updatedUserRes = await dbClient.query(
      `
        ${userDetailSelect}
        WHERE u.id = $1
      `,
      [id]
    );

    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user: normalizeUser(updatedUserRes.rows[0])
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Delete a user by ID
 * @route   DELETE /api/admin/users/:id
 * @access  Private/Admin
 */
const deleteUser = async (req, res, next) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // This is a hard delete. Profile rows with ON DELETE CASCADE will be removed automatically.
    // Other related records may block deletion through foreign-key constraints.
    const deletedUserRes = await pool.query(
      `
        DELETE FROM users
        WHERE id = $1
        RETURNING id, full_name, email, role, is_verified, acc_status, created_at
      `,
      [id]
    );

    if (deletedUserRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      user: {
        id: deletedUserRes.rows[0].id,
        fullName: deletedUserRes.rows[0].full_name,
        email: deletedUserRes.rows[0].email,
        role: deletedUserRes.rows[0].role,
        isVerified: deletedUserRes.rows[0].is_verified,
        accStatus: deletedUserRes.rows[0].acc_status,
        createdAt: deletedUserRes.rows[0].created_at
      }
    });
  } catch (err) {
    if (err.code === '23503') {
      // PostgreSQL foreign-key violation: the user still owns related records
      // such as projects, messages, reviews, or disputes.
      err.message = 'Cannot delete this user because related records still exist';
      err.statusCode = 409;
    }

    return next(err);
  }
};

/**
 * @desc    Deactivate a user account by ID
 * @route   PUT /api/admin/users/:id/deactivate
 * @access  Private/Admin
 */
const deactivateUser = async (req, res, next) => {
  const { id } = req.params;

  if (!isValidUuid(id)) {
    const err = new Error('Invalid user id');
    err.statusCode = 400;
    return next(err);
  }

  try {
    // Deactivate is a soft ban: the user row remains in the database,
    // but acc_status=false marks the account as not allowed to operate.
    const userRes = await pool.query(
      `
        UPDATE users
        SET acc_status = false
        WHERE id = $1
        RETURNING id, full_name, email, role, is_verified, acc_status, created_at
      `,
      [id]
    );

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      message: 'User account deactivated successfully',
      user: {
        id: userRes.rows[0].id,
        fullName: userRes.rows[0].full_name,
        email: userRes.rows[0].email,
        role: userRes.rows[0].role,
        isVerified: userRes.rows[0].is_verified,
        accStatus: userRes.rows[0].acc_status,
        createdAt: userRes.rows[0].created_at
      }
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  deactivateUser
};
