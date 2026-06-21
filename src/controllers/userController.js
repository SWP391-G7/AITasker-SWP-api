const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { generateToken } = require('../utils/token');

/**
 * Helper to validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * @desc    Update user full name
 * @route   PUT /api/users/update-fullname
 * @access  Private
 */
const updateFullname = async (req, res, next) => {
  const userId = req.user.id;
  const { fullName } = req.body;

  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    const err = new Error('Full name is required');
    err.statusCode = 400;
    return next(err);
  }

  try {
    const updateQuery = `
      UPDATE users 
      SET full_name = $1 
      WHERE id = $2 
      RETURNING id, full_name, email, role, is_verified, created_at;
    `;
    const userRes = await pool.query(updateQuery, [fullName.trim(), userId]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const updatedUser = userRes.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Full name updated successfully',
      user: {
        id: updatedUser.id,
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.is_verified,
        createdAt: updatedUser.created_at
      }
    });

  } catch (err) {
    return next(err);
  }
};

/**
 * @desc    Update user email with code verification
 * @route   PUT /api/users/update-email
 * @access  Private
 */
const updateEmail = async (req, res, next) => {
  const userId = req.user.id;
  const { newEmail, code } = req.body;

  if (!newEmail || !isValidEmail(newEmail)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!code || code.length !== 6 || isNaN(code)) {
    const err = new Error('Code must be a 6-digit number');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = newEmail.toLowerCase().trim();
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    // 1. Check if email is already taken by another user
    const checkEmailQuery = 'SELECT id FROM users WHERE email = $1 AND id != $2';
    const checkEmailRes = await dbClient.query(checkEmailQuery, [normalizedEmail, userId]);
    
    if (checkEmailRes.rows.length > 0) {
      const err = new Error('Email is already in use by another account');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // 2. Validate the verification code
    const findCodeQuery = `
      SELECT id, code, expires_at, is_used 
      FROM email_verification_codes 
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const codeRes = await dbClient.query(findCodeQuery, [normalizedEmail]);

    if (codeRes.rows.length === 0) {
      const err = new Error('No verification code found for this email. Send code first.');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const verificationRecord = codeRes.rows[0];

    if (verificationRecord.is_used) {
      const err = new Error('This verification code has already been used');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (new Date() > new Date(verificationRecord.expires_at)) {
      const err = new Error('Verification code has expired');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (verificationRecord.code !== code) {
      const err = new Error('Invalid verification code');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // 3. Mark verification code as used
    const updateCodeQuery = 'UPDATE email_verification_codes SET is_used = true WHERE id = $1';
    await dbClient.query(updateCodeQuery, [verificationRecord.id]);

    // 4. Update the user email
    const updateUserQuery = `
      UPDATE users
      SET email = $1, is_verified = true
      WHERE id = $2
      RETURNING id, full_name, email, role, is_verified, created_at;
    `;
    const userRes = await dbClient.query(updateUserQuery, [normalizedEmail, userId]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const updatedUser = userRes.rows[0];

    await dbClient.query('COMMIT');

    // 5. Generate a new token reflecting the email change
    const token = generateToken({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role
    });

    return res.status(200).json({
      success: true,
      message: 'Email updated successfully',
      user: {
        id: updatedUser.id,
        fullName: updatedUser.full_name,
        email: updatedUser.email,
        role: updatedUser.role,
        isVerified: updatedUser.is_verified,
        createdAt: updatedUser.created_at
      },
      token
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

/**
 * @desc    Update user password with code verification
 * @route   PUT /api/users/update-password
 * @access  Private
 */
const updatePassword = async (req, res, next) => {
  const userId = req.user.id;
  const { newPassword, code } = req.body;

  if (!newPassword || newPassword.length < 6) {
    const err = new Error('New password must be at least 6 characters long');
    err.statusCode = 400;
    return next(err);
  }

  if (!code || code.length !== 6 || isNaN(code)) {
    const err = new Error('Code must be a 6-digit number');
    err.statusCode = 400;
    return next(err);
  }

  const dbClient = await pool.connect();

  try {
    // Get user's current email
    const userQuery = 'SELECT email FROM users WHERE id = $1';
    const userRes = await dbClient.query(userQuery, [userId]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const currentEmail = userRes.rows[0].email;

    await dbClient.query('BEGIN');

    // 1. Validate the verification code sent to current email
    const findCodeQuery = `
      SELECT id, code, expires_at, is_used 
      FROM email_verification_codes 
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const codeRes = await dbClient.query(findCodeQuery, [currentEmail]);

    if (codeRes.rows.length === 0) {
      const err = new Error('No verification code found for your email. Send code first.');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const verificationRecord = codeRes.rows[0];

    if (verificationRecord.is_used) {
      const err = new Error('This verification code has already been used');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (new Date() > new Date(verificationRecord.expires_at)) {
      const err = new Error('Verification code has expired');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (verificationRecord.code !== code) {
      const err = new Error('Invalid verification code');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    // 2. Mark code as used
    const updateCodeQuery = 'UPDATE email_verification_codes SET is_used = true WHERE id = $1';
    await dbClient.query(updateCodeQuery, [verificationRecord.id]);

    // 3. Hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // 4. Update the user password in database
    const updatePasswordQuery = 'UPDATE users SET password = $1 WHERE id = $2';
    await dbClient.query(updatePasswordQuery, [hashedPassword, userId]);

    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

module.exports = {
  updateFullname,
  updateEmail,
  updatePassword
};
