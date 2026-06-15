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

/**
 * @desc    Get all services by the current expert
 * @route   GET /api/services/my
 * @access  Private
 */
const getMyServices = async (req, res, next) => {
  const userId = req.user.id

  try {
    const query = `
      SELECT * FROM services
      WHERE expert_id = $1
      ORDER BY id DESC;
    `

    const result = await pool.query(query, [userId])

    return res.status(200).json({
      success: true,
      services: result.rows,
      data: result.rows
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Get a single service by ID
 * @route   GET /api/services/:id
 * @access  Private
 */
const getServiceById = async (req, res, next) => {
  const { id } = req.params

  try {
    const query = `
      SELECT * FROM services
      WHERE id = $1;
    `

    const result = await pool.query(query, [id])

    if (result.rows.length === 0) {
      const err = new Error('Service not found')
      err.statusCode = 404
      return next(err)
    }

    return res.status(200).json({
      success: true,
      service: result.rows[0],
      data: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Update a service
 * @route   PUT /api/services/:id
 * @access  Private
 */
const updateService = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id
  const { title, description, price, pricing_type, delivery_days, tags } = req.body

  try {
    // Check if service exists and belongs to current user
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [id])

    if (serviceCheck.rows.length === 0) {
      const err = new Error('Service not found')
      err.statusCode = 404
      return next(err)
    }

    if (serviceCheck.rows[0].expert_id !== userId) {
      const err = new Error('Forbidden: You can only update your own services')
      err.statusCode = 403
      return next(err)
    }

    // Input validation for provided fields
    const errors = {}

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim() === '') {
        errors.title = 'Service title cannot be empty'
      } else if (title.length > 255) {
        errors.title = 'Service title cannot exceed 255 characters'
      }
    }

    let parsedPrice = undefined
    if (price !== undefined) {
      if (price === null || price === '') {
        errors.price = 'Price is required'
      } else {
        parsedPrice = parseFloat(price)
        if (isNaN(parsedPrice) || parsedPrice <= 0) {
          errors.price = 'Price must be a positive number'
        }
      }
    }

    if (pricing_type !== undefined) {
      const validPricingTypes = ['fixed', 'hourly']
      if (!validPricingTypes.includes(pricing_type)) {
        errors.pricing_type = 'Pricing type must be either fixed or hourly'
      }
    }

    let parsedDeliveryDays = undefined
    if (delivery_days !== undefined) {
      if (delivery_days === null || delivery_days === '') {
        errors.delivery_days = 'Delivery days is required'
      } else {
        parsedDeliveryDays = parseInt(delivery_days, 10)
        if (isNaN(parsedDeliveryDays) || parsedDeliveryDays <= 0) {
          errors.delivery_days = 'Delivery days must be a positive integer'
        }
      }
    }

    if (tags !== undefined && tags !== null && tags.length > 255) {
      errors.tags = 'Tags cannot exceed 255 characters'
    }

    if (Object.keys(errors).length > 0) {
      const err = new Error('Validation failed')
      err.statusCode = 400
      err.errors = errors
      return next(err)
    }

    // Build dynamic update query
    const updates = []
    const values = []
    let paramCount = 1

    if (title !== undefined) {
      updates.push(`title = $${paramCount}`)
      values.push(title.trim())
      paramCount++
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount}`)
      values.push(description ? description.trim() : null)
      paramCount++
    }

    if (parsedPrice !== undefined) {
      updates.push(`price = $${paramCount}`)
      values.push(parsedPrice)
      paramCount++
    }

    if (pricing_type !== undefined) {
      updates.push(`pricing_type = $${paramCount}`)
      values.push(pricing_type)
      paramCount++
    }

    if (parsedDeliveryDays !== undefined) {
      updates.push(`delivery_days = $${paramCount}`)
      values.push(parsedDeliveryDays)
      paramCount++
    }

    if (tags !== undefined) {
      updates.push(`tags = $${paramCount}`)
      values.push(tags ? tags.trim() : null)
      paramCount++
    }

    if (updates.length === 0) {
      const err = new Error('No fields to update')
      err.statusCode = 400
      return next(err)
    }

    values.push(id)

    const updateQuery = `
      UPDATE services
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *;
    `

    const result = await pool.query(updateQuery, values)

    return res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      service: result.rows[0],
      data: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @desc    Delete a service
 * @route   DELETE /api/services/:id
 * @access  Private
 */
const deleteService = async (req, res, next) => {
  const { id } = req.params
  const userId = req.user.id

  try {
    // Check if service exists and belongs to current user
    const serviceCheck = await pool.query('SELECT * FROM services WHERE id = $1', [id])

    if (serviceCheck.rows.length === 0) {
      const err = new Error('Service not found')
      err.statusCode = 404
      return next(err)
    }

    if (serviceCheck.rows[0].expert_id !== userId) {
      const err = new Error('Forbidden: You can only delete your own services')
      err.statusCode = 403
      return next(err)
    }

    const deleteQuery = 'DELETE FROM services WHERE id = $1 RETURNING *;'
    const result = await pool.query(deleteQuery, [id])

    return res.status(200).json({
      success: true,
      message: 'Service deleted successfully',
      data: result.rows[0]
    })
  } catch (error) {
    return next(error)
  }
}

module.exports = {
  createService,
  getMyServices,
  getServiceById,
  updateService,
  deleteService
}
