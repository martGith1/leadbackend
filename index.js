require('dotenv').config();
const express = require('express');
const cors = require('cors');
const paymentRoutes = require('./routes/create-payment');

const app = express();

// 1. Ultimate CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  'https://f00e75544225.ngrok-free.app'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`Blocked CORS request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'ngrok-skip-browser-warning',
    'x-requested-with'
  ],
  exposedHeaders: [
    'x-api-key',
    'x-request-id'
  ],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204,
  maxAge: 86400
};

// 2. Apply CORS middleware
app.use(cors(corsOptions));

// 3. Special headers middleware
app.use((req, res, next) => {
  // Required for ngrok
  res.header('ngrok-skip-browser-warning', 'true');
  
  // Security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  
  // Dynamic CORS headers
  if (allowedOrigins.includes(req.headers.origin)) {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  
  next();
});

// 4. Explicit OPTIONS handler
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.status(204).end();
});

// 5. Body parsers
app.use('/api/payment-webhook', express.raw({ type: '*/*' }));
app.use(express.json());

// 6. Routes
app.get('/', (req, res) => {
  res.json({
    status: 'API Running',
    cors: {
      allowedOrigins,
      yourOrigin: req.headers.origin,
      allowed: allowedOrigins.includes(req.headers.origin)
    }
  });
});

app.use('/api', paymentRoutes);

// 7. Error handling
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS Policy Violation',
      allowedOrigins,
      yourOrigin: req.headers.origin,
      message: `The origin '${req.headers.origin}' is not allowed`
    });
  }
  
  console.error('API Error:', {
    path: req.path,
    method: req.method,
    error: err.stack
  });
  
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`🌐 Ngrok: https://f00e75544225.ngrok-free.app`);
  console.log('🛡️ CORS Enabled for:');
  allowedOrigins.forEach(origin => console.log(`   - ${origin}`));
});