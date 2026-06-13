const bcrypt = require('bcryptjs')
const { pool } = require('../config/db')
const { generateToken } = require('../utils/token')

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
      RETURNING id, full_name, email, role, is_verified, created_at;
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
        createdAt: newUser.created_at
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

    // 3. Check if user email is verified
    if (!user.is_verified) {
      const err = new Error('Email not verified')
      err.statusCode = 403
      err.isVerificationRequired = true
      err.email = user.email
      return next(err)
    }

    // 4. Generate token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    })

    // 5. Return successful response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        isVerified: user.is_verified,
        createdAt: user.created_at
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
      SELECT id, full_name, email, role, is_verified, created_at 
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
        createdAt: user.created_at
      }
    })
  } catch (err) {
    return next(err)
  }
}

module.exports = {
  register,
  login,
  getMe
}
