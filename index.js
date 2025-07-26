require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const paymentRoutes = require('./routes/create-payment');

// Initialize Express
const app = express();

// ======================
// 1. Environment Checks
// ======================
const REQUIRED_ENV = ['NOWPAYMENTS_API_KEY', 'PORT'];
REQUIRED_ENV.forEach(variable => {
  if (!process.env[variable]) {
    console.error(`❌ Missing required environment variable: ${variable}`);
    process.exit(1);
  }
});

// ======================
// 2. Security Middleware
// ======================
const allowedOrigins = [
  'http://localhost:5173', // Your local frontend
  process.env.PRODUCTION_URL // Your live frontend (optional)
].filter(Boolean); // Remove empty values

// Rate limiting (100 requests per 15 mins)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
}));

// CORS Configuration
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
}));

// Security Headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});

// ======================
// 3. Request Handling
// ======================
// Body Parsers
app.use('/api/payment-webhook', express.raw({ type: '*/*' }));
app.use(express.json());

// Health Check
app.get('/', (req, res) => {
  res.json({
    status: 'API Healthy',
    version: '1.0.0',
    allowedOrigins
  });
});

// Routes
app.use('/api', paymentRoutes);

// ======================
// 4. Error Handling
// ======================
// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('API Error:', {
    path: req.path,
    method: req.method,
    error: process.env.NODE_ENV === 'development' ? err.stack : 'Internal error'
  });
  
  res.status(500).json({ 
    error: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
});

// ======================
// 5. Start Server
// ======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('🛡️ Allowed Origins:');
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
});
