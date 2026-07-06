const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { sendPasswordResetCode } = require('../utils/emailService');

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const requestPasswordReset = async (req, res, next) => {
  const { email } = req.body;

  if (!email || !isValidEmail(email)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

    if (userRes.rows.length === 0) {
      const err = new Error('No account found with this email');
      err.statusCode = 404;
      return next(err);
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const upsertQuery = `
      INSERT INTO email_verification_codes (email, code, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (email)
      DO UPDATE SET code = $2, expires_at = $3, is_used = false
      RETURNING email, expires_at;
    `;

    await pool.query(upsertQuery, [normalizedEmail, code, expiresAt]);
    await sendPasswordResetCode(normalizedEmail, code);

    return res.status(200).json({
      success: true,
      message: 'Password reset code sent to your email',
      email: normalizedEmail
    });
  } catch (err) {
    console.error('Error requesting password reset:', err);
    return next(err);
  }
};

const verifyPasswordResetCode = async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !isValidEmail(email)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!code || code.length !== 6 || isNaN(code)) {
    const err = new Error('Code must be a 6-digit number');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const findCodeQuery = `
      SELECT code, expires_at, is_used
      FROM email_verification_codes
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const codeRes = await pool.query(findCodeQuery, [normalizedEmail]);

    if (codeRes.rows.length === 0) {
      const err = new Error('No password reset code found for this email');
      err.statusCode = 404;
      return next(err);
    }

    const verificationRecord = codeRes.rows[0];

    if (verificationRecord.is_used) {
      const err = new Error('This code has already been used');
      err.statusCode = 400;
      return next(err);
    }

    if (new Date() > new Date(verificationRecord.expires_at)) {
      const err = new Error('Password reset code has expired');
      err.statusCode = 400;
      return next(err);
    }

    if (verificationRecord.code !== code) {
      const err = new Error('Invalid password reset code');
      err.statusCode = 400;
      return next(err);
    }

    return res.status(200).json({
      success: true,
      message: 'Password reset code verified'
    });
  } catch (err) {
    console.error('Error verifying password reset code:', err);
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  const { email, code, newPassword } = req.body;

  if (!email || !isValidEmail(email)) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  if (!code || code.length !== 6 || isNaN(code)) {
    const err = new Error('Code must be a 6-digit number');
    err.statusCode = 400;
    return next(err);
  }

  if (!newPassword || newPassword.length < 6) {
    const err = new Error('New password must be at least 6 characters long');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const dbClient = await pool.connect();

  try {
    await dbClient.query('BEGIN');

    const findCodeQuery = `
      SELECT id, code, expires_at, is_used
      FROM email_verification_codes
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const codeRes = await dbClient.query(findCodeQuery, [normalizedEmail]);

    if (codeRes.rows.length === 0) {
      const err = new Error('No password reset code found for this email');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const verificationRecord = codeRes.rows[0];

    if (verificationRecord.is_used) {
      const err = new Error('This code has already been used');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (new Date() > new Date(verificationRecord.expires_at)) {
      const err = new Error('Password reset code has expired');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    if (verificationRecord.code !== code) {
      const err = new Error('Invalid password reset code');
      err.statusCode = 400;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const updateUserQuery = 'UPDATE users SET password = $1 WHERE email = $2 RETURNING id';
    const userRes = await dbClient.query(updateUserQuery, [hashedPassword, normalizedEmail]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      await dbClient.query('ROLLBACK');
      return next(err);
    }

    await dbClient.query('UPDATE email_verification_codes SET is_used = true WHERE id = $1', [verificationRecord.id]);
    await dbClient.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    return next(err);
  } finally {
    dbClient.release();
  }
};

module.exports = {
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPassword
};
