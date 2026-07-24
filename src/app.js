/**
 * Backend module: app.js
 *
 * Vai trò: app: điểm ghép nối và khởi động các thành phần chính của backend.
 * Luồng chính: Nạp cấu hình, middleware, route hoặc server lifecycle theo thứ tự cần thiết.
 * Lưu ý bảo trì: Thứ tự khởi tạo có thể ảnh hưởng CORS, error handling, WebSocket và khả năng nhận request.
 */
const express = require('express')
const swaggerUi = require('swagger-ui-express')
const swaggerDocument = require('./swagger.json')
const cors = require('cors')
const { errorHandler } = require('./middleware/errorMiddleware')
const authRoutes = require('./routes/authRoutes')
const aiRoutes = require('./routes/aiRoutes')
const profileRoutes = require('./routes/profileRoutes')
const jobRoutes = require('./routes/jobRoutes')
const searchRoutes = require('./routes/searchRoutes')
const serviceRoutes = require('./routes/serviceRoutes')
const userRoutes = require('./routes/userRoutes')
const conversationRoutes = require('./routes/conversationRoutes')
const messageRoutes = require('./routes/messageRoutes')
const proposalRoutes = require('./routes/proposalRoutes')
const projectRoutes = require('./routes/projectRoutes')
const milestoneRoutes = require('./routes/milestoneRoutes')
const ratingRoutes = require('./routes/ratingRoutes')
const reviewRoutes = require('./routes/reviewRoutes')
const notificationRoutes = require('./routes/notificationRoutes')
const invitationRoutes = require('./routes/invitationRoutes')
const transactionRoutes = require('./routes/transactionRoutes')
const uploadRoutes = require('./routes/uploadRoutes')
const adminRoutes = require('./routes/adminRoutes')
const paymentRoutes = require('./routes/paymentRoutes')

const app = express()

// Set up middlewares
app.use(cors({
  origin: '*', // Allow React frontend from any origin for ease of development; restrict in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With', 'Pragma']
}))

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date(),
    service: 'AITasker API Backend'
  })
})
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customSiteTitle: "AITasker API Documentation",
  swaggerOptions: {
    persistAuthorization: true
  }
})) // SwaggerUI for API documents

// Mount modular routes
app.use('/api/auth', authRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/jobs', jobRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/services', serviceRoutes)
app.use('/api/users', userRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/proposals', proposalRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/milestones', milestoneRoutes)
app.use('/api/ratings', ratingRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/invitations', invitationRoutes)
app.use('/api/transactions', transactionRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/payment', paymentRoutes)

// Handle 404 Route Not Found
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`)
  error.statusCode = 404
  next(error)
})

// Wire up global error-handling middleware
app.use(errorHandler)

module.exports = app
