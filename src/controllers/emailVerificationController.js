const { pool } = require('../config/db');
const { sendVerificationCode } = require('../utils/emailService');

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendCodeToEmail = async (req, res, next) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    const err = new Error('A valid email address is required');
    err.statusCode = 400;
    return next(err);
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
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
    await sendVerificationCode(normalizedEmail, code);

    return res.status(200).json({
      success: true,
      message: 'Verification code sent to your email',
      email: normalizedEmail
    });

  } catch (err) {
    console.error('Error sending verification code:', err);
    return next(err);
  }
};

const verifyCode = async (req, res, next) => {
  const { email, code } = req.body;

  if (!email || !email.includes('@')) {
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
      SELECT id, code, expires_at, is_used 
      FROM email_verification_codes 
      WHERE email = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    
    const codeRes = await pool.query(findCodeQuery, [normalizedEmail]);

    if (codeRes.rows.length === 0) {
      const err = new Error('No verification code found for this email');
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
      const err = new Error('Verification code has expired');
      err.statusCode = 400;
      return next(err);
    }

    if (verificationRecord.code !== code) {
      const err = new Error('Invalid verification code');
      err.statusCode = 400;
      return next(err);
    }

    const updateCodeQuery = `
      UPDATE email_verification_codes
      SET is_used = true
      WHERE id = $1;
    `;
    await pool.query(updateCodeQuery, [verificationRecord.id]);

    const updateUserQuery = `
      UPDATE users
      SET is_verified = true
      WHERE email = $1
      RETURNING id, full_name, email, role, is_verified;
    `;
    
    const userRes = await pool.query(updateUserQuery, [normalizedEmail]);

    if (userRes.rows.length === 0) {
      const err = new Error('User not found');
      err.statusCode = 404;
      return next(err);
    }

    const user = userRes.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified
      }
    });

  } catch (err) {
    console.error('Error verifying code:', err);
    return next(err);
  }
};

module.exports = {
  sendCodeToEmail,
  verifyCode
};
