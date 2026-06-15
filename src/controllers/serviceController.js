const { pool } = require('../config/db')

/**
 * @desc    Create a new service listing
 * @route   POST /api/services
 * @access  Private (Expert only)
 */
const createService = async (req, res, next) => {
  const userId = req.user.id
  const userRole = req.user.role

  // 1. Enforce that only experts (or admins) can post services
  if (userRole !== 'expert' && userRole !== 'admin') {
    const err = new Error('Forbidden: Only users with the role expert can post services.')
    err.statusCode = 403
    return next(err)
  }

  const {
    title,
    description,
    price,
    pricing_type,
    delivery_days,
    tags
  } = req.body

  // 2. Input Validation
  const errors = {}

  if (!title || typeof title !== 'string' || title.trim() === '') {
    errors.title = 'Service title is required'
  } else if (title.length > 255) {
    errors.title = 'Service title cannot exceed 255 characters'
  }

  if (description && typeof description !== 'string') {
    errors.description = 'Description must be a string'
  }

  let parsedPrice = null
  if (price === undefined || price === null || price === '') {
    errors.price = 'Price is required'
  } else {
    parsedPrice = parseFloat(price)
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      errors.price = 'Price must be a positive number'
    }
  }

  const validPricingTypes = ['fixed', 'hourly']
  if (!pricing_type || !validPricingTypes.includes(pricing_type)) {
    errors.pricing_type = 'Pricing type must be either fixed or hourly'
  }

  let parsedDeliveryDays = null
  if (delivery_days === undefined || delivery_days === null || delivery_days === '') {
    errors.delivery_days = 'Delivery days is required'
  } else {
    parsedDeliveryDays = parseInt(delivery_days, 10)
    if (isNaN(parsedDeliveryDays) || parsedDeliveryDays <= 0) {
      errors.delivery_days = 'Delivery days must be a positive integer'
    }
  }

  if (tags && tags.length > 255) {
    errors.tags = 'Tags cannot exceed 255 characters'
  }

  if (Object.keys(errors).length > 0) {
    const err = new Error('Validation failed')
    err.statusCode = 400
    err.errors = errors
    return next(err)
  }

  try {
    // 3. Ensure an expert profile exists for the user to preserve referential integrity
    const expertProfileCheck = await pool.query('SELECT 1 FROM expert_profiles WHERE id = $1', [userId])
    if (expertProfileCheck.rows.length === 0) {
      await pool.query('INSERT INTO expert_profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [userId])
    }

    // 4. Insert Service Listing
    const insertQuery = `
      INSERT INTO services (
        expert_id,
        title,
        description,
        price,
        pricing_type,
        delivery_days,
        tags
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `

    const values = [
      userId,
      title.trim(),
      description ? description.trim() : null,
      parsedPrice,
      pricing_type,
      parsedDeliveryDays,
      tags ? tags.trim() : null
    ]

    const result = await pool.query(insertQuery, values)

    return res.status(201).json({
      success: true,
      message: 'Service posted successfully',
      service: result.rows[0]
    })

  } catch (error) {
    return next(error)
  }
}

module.exports = {
  createService
}
