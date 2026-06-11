const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorMiddleware');
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const jobRoutes = require('./routes/jobRoutes');

const app = express();

// 1. Set up middlewares
app.use(cors({
  origin: '*', // Allow React frontend from any origin for ease of development; restrict in production
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date(),
    service: 'AITasker API Backend'
  });
});

// 3. Mount modular routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/jobs', jobRoutes);

// 4. Handle 404 Route Not Found
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// 5. Wire up global error-handling middleware
app.use(errorHandler);

module.exports = app;
