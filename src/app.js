const express = require('express')
const swaggerUi = require('swagger-ui-express')
const swaggerDocument = require('./swagger.json')
const cors = require('cors')
const { errorHandler } = require('./middleware/errorMiddleware')
const authRoutes = require('./routes/authRoutes')
const profileRoutes = require('./routes/profileRoutes')
const jobRoutes = require('./routes/jobRoutes')
const searchRoutes = require('./routes/searchRoutes')
const serviceRoutes = require('./routes/serviceRoutes')
const userRoutes = require('./routes/userRoutes')
const conversationRoutes = require('./routes/conversationRoutes')
const messageRoutes = require('./routes/messageRoutes')
const proposalRoutes = require('./routes/proposalRoutes')

const app = express()

// Set up middlewares
app.use(cors({
  origin: '*', // Allow React frontend from any origin for ease of development; restrict in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument)) // SwaggerUI for API documents

// Mount modular routes
app.use('/api/auth', authRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/jobs', jobRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/services', serviceRoutes)
app.use('/api/users', userRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/proposals', proposalRoutes)

// Handle 404 Route Not Found
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`)
  error.statusCode = 404
  next(error)
})

// Wire up global error-handling middleware
app.use(errorHandler)

module.exports = app
