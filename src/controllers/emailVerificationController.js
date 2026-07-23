/**
 * Backend module: controllers/emailVerificationController.js
 *
 * Vai trò: Controller email Verification Controller: tiếp nhận request đã đi qua route/middleware, kiểm tra dữ liệu đầu vào và điều phối nghiệp vụ.
 * Luồng chính: Đọc req/user/params/body, làm việc với PostgreSQL hoặc dịch vụ ngoài, sau đó trả JSON chuẩn hoặc chuyển lỗi cho error middleware.
 * Lưu ý bảo trì: Khi sửa controller cần giữ status code, quyền truy cập, transaction và cấu trúc response đồng nhất với frontend.
 */
const { pool } = require('../config/db');
const { sendVerificationCode } = require('../utils/emailService');
const { generateToken } = require('../utils/token');

// Thực hiện phần logic “generate verification code” trong phạm vi trách nhiệm của module hiện tại.
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Tạo hoặc gửi dữ liệu cho nghiệp vụ “send code to email”, đồng thời chuyển lỗi về caller/UI theo cơ chế của module.
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

// Thực hiện phần logic “verify code” trong phạm vi trách nhiệm của module hiện tại.
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

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified
      },
      token
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
