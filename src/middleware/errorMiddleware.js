/**
 * Express custom error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('API Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    url: req.originalUrl,
    method: req.method,
  })

  const statusCode = err.statusCode || 500

  const response = {
    success: false,
    message: err.message || 'Internal Server Error',
    // Include validation errors if available (from request payload check)
    errors: err.errors || null,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  }

  // Add verification error details if applicable
  if (err.isVerificationRequired) {
    response.isVerificationRequired = true
    response.email = err.email
  }

  res.status(statusCode).json(response)
}

module.exports = { errorHandler }
