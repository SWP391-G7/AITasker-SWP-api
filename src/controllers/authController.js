const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { generateToken } = require('../utils/token')
const { OAuth2Client } = require('google-auth-library')
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

/**
 * Helper to validate email format
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
const register = async (req, res, next) => {
  const { fullName, email, password, role } = req.body

  // 1. Basic validation checks
  const errors = {}
  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    errors.fullName = 'Full name is required'
  }
  if (!email || !isValidEmail(email)) {
    errors.email = 'A valid email address is required'
  }
  if (!password || password.length < 6) {
    errors.password = 'Password must be at least 6 characters long'
  }

  const validRoles = ['client', 'expert', 'admin']
  if (!role || !validRoles.includes(role)) {
    errors.role = 'Role must be one of: client, expert, admin'
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  const normalizedEmail = email.toLowerCase().trim()
  const dbClient = await pool.connect()

  try {
    // 2. Check if user already exists
    const checkUserQuery = 'SELECT id FROM users WHERE email = $1'
    const checkUserRes = await dbClient.query(checkUserQuery, [normalizedEmail])

    if (checkUserRes.rows.length > 0) {
      const err = new Error('Email is already registered')
      err.statusCode = 400
      return next(err)
    }

    // 3. Hash the password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // 4. Execute database transaction
    await dbClient.query('BEGIN')

    // Insert user into users table
    const insertUserQuery = `
      INSERT INTO users (full_name, email, role, password)
      VALUES ($1, $2, $3, $4)
      RETURNING id, full_name, email, role, is_verified, created_at, avatar_url;
    `
    const userRes = await dbClient.query(insertUserQuery, [
      fullName.trim(),
      normalizedEmail,
      role,
      hashedPassword
    ])

    const newUser = userRes.rows[0]

    // Conditionally create the matching profile based on the role to preserve referential integrity
    if (role === 'client') {
      const insertClientProfileQuery = 'INSERT INTO client_profiles (id) VALUES ($1)'
      await dbClient.query(insertClientProfileQuery, [newUser.id])
    } else if (role === 'expert') {
      const insertExpertProfileQuery = 'INSERT INTO expert_profiles (id) VALUES ($1)'
      await dbClient.query(insertExpertProfileQuery, [newUser.id])
    }
    // No action needed for 'admin' as there is no specific admin profile table in schema.sql

    await dbClient.query('COMMIT')

    // 5. Generate authentication token
    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role
    })

    // 6. Return response
    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: newUser.id,
        fullName: newUser.full_name,
        email: newUser.email,
        role: newUser.role,
        isVerified: newUser.is_verified,
        createdAt: newUser.created_at,
        avatarUrl: newUser.avatar_url
      },
      token
    })

  } catch (err) {
    await dbClient.query('ROLLBACK')
    return next(err)
  } finally {
    dbClient.release()
  }
}

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = async (req, res, next) => {
  const { email, password } = req.body

  // Basic validation checks
  const errors = {}
  if (!email || !isValidEmail(email)) {
    errors.email = 'A valid email address is required'
  }
  if (!password) {
    errors.password = 'Password is required'
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  const normalizedEmail = email.toLowerCase().trim()

  try {
    // 1. Find user by email
    const findUserQuery = 'SELECT * FROM users WHERE email = $1'
    const userRes = await pool.query(findUserQuery, [normalizedEmail])

    if (userRes.rows.length === 0) {
      const err = new Error('Invalid email or password')
      err.statusCode = 401
      return next(err)
    }

    const user = userRes.rows[0]

    // 2. Compare passwords
    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      const err = new Error('Invalid email or password')
      err.statusCode = 401
      return next(err)
    }

    // 3. Generate token (login is allowed even for unverified users;
    //    the frontend will redirect them to /verify based on isVerified flag)
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    })

    // 4. Return successful response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at,
        avatarUrl: user.avatar_url
      },
      token
    })

  } catch (err) {
    return next(err)
  }
}

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = async (req, res, next) => {
  try {
    // req.user has already been populated by authMiddleware (protect)
    const findUserQuery = `
      SELECT id, full_name, email, role, is_verified, created_at, avatar_url 
      FROM users 
      WHERE id = $1
    `
    const userRes = await pool.query(findUserQuery, [req.user.id])

    if (userRes.rows.length === 0) {
      const err = new Error('User not found')
      err.statusCode = 404
      return next(err)
    }

    const user = userRes.rows[0]

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at,
        avatarUrl: user.avatar_url
      }
    })
  } catch (err) {
    return next(err)
  }
}

/**
 * @desc    Authenticate with Google & get token
 * @route   POST /api/auth/google
 * @access  Public
 */
const googleLogin = async (req, res, next) => {
  const { idToken, accessToken } = req.body

  if (!idToken && !accessToken) {
    const err = new Error('Google token (idToken or accessToken) is required')
    err.statusCode = 400
    return next(err)
  }

  try {
    let payload

    if (idToken) {
      // Verify the Google ID Token
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      })

      payload = ticket.getPayload()
    } else {
      // Fetch user profile info from Google UserInfo endpoint using Access Token
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to verify access token with Google')
      }

      payload = await response.json()
    }

    if (!payload) {
      const err = new Error('Invalid Google token payload')
      err.statusCode = 400
      return next(err)
    }

    const { email, name } = payload
    
    if (!email) {
      const err = new Error('Google token must contain email')
      err.statusCode = 400
      return next(err)
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Find user by email
    const findUserQuery = 'SELECT * FROM users WHERE email = $1'
    const userRes = await pool.query(findUserQuery, [normalizedEmail])

    let user;
    let isNewUser = false;

    if (userRes.rows.length > 0) {
      user = userRes.rows[0]
    } else {
      // Create a new user with Google account details
      isNewUser = true
      
      // Generate a secure random password to satisfy db NOT NULL constraint
      const randomPassword = require('crypto').randomBytes(16).toString('hex')
      const salt = await bcrypt.genSalt(10)
      const hashedPassword = await bcrypt.hash(randomPassword, salt)

      const dbClient = await pool.connect()

      try {
        await dbClient.query('BEGIN')

        // Insert new user as 'client' by default (consistent with web sign up)
        const insertUserQuery = `
          INSERT INTO users (full_name, email, role, password, is_verified)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, full_name, email, role, is_verified, created_at, avatar_url;
        `
        // Since Google verified the email, we set is_verified to true
        const insertUserRes = await dbClient.query(insertUserQuery, [
          name ? name.trim() : 'Google User',
          normalizedEmail,
          'client',
          hashedPassword,
          true
        ])
        user = insertUserRes.rows[0]

        // Create default client profile
        const insertClientProfileQuery = 'INSERT INTO client_profiles (id) VALUES ($1)'
        await dbClient.query(insertClientProfileQuery, [user.id])

        await dbClient.query('COMMIT')
      } catch (transactionErr) {
        await dbClient.query('ROLLBACK')
        throw transactionErr
      } finally {
        dbClient.release()
      }
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    })

    return res.status(isNewUser ? 201 : 200).json({
      success: true,
      message: isNewUser ? 'Registration and Login successful' : 'Login successful',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at,
        avatarUrl: user.avatar_url
      },
      token
    })

  } catch (err) {
    console.error('Google verification error:', err)
    const verificationError = new Error('Google token verification failed')
    verificationError.statusCode = 401
    return next(verificationError)
  }
}


module.exports = {
  register,
  login,
  getMe,
  googleLogin
}
