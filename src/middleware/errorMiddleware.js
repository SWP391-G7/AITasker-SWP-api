/**
 * Backend module: middleware/errorMiddleware.js
 *
 * Vai trò: Middleware error Middleware: xử lý yêu cầu dùng chung trước hoặc sau controller.
 * Luồng chính: Đọc request, bổ sung context hoặc chuẩn hóa lỗi rồi gọi next để chuyển sang bước kế tiếp.
 * Lưu ý bảo trì: Middleware phải kết thúc response hoặc gọi next đúng một lần để tránh request bị treo.
 */
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
