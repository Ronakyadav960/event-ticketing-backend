// server.js ✅ UPDATED (Payments route always mounted)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const dashboardRoutes = require('./routes/dashboard.routes');

const app = express();

// ✅ Render/Vercel behind proxy
app.set('trust proxy', 1);

/**
 * ✅ CORS
 */
const allowedOrigins = [
  'http://localhost:4200',
  ...(process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map((s) => s.trim())
    : []),
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.options(/.*/, cors());

// ✅ Stripe check (only for warning now)
const STRIPE_ENABLED = !!(
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
);

// ✅ Stripe webhook needs RAW body BEFORE json()
if (STRIPE_ENABLED) {
  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.disable('etag');

// optional cache headers
app.use((req, res, next) => {
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// ✅ ROUTES
app.use('/api/auth', require('./routes/auth.routes'));                              
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));


// ✅ IMPORTANT FIX: Always mount payments route
app.use('/api/payments', require('./routes/payment.routes'));

if (!STRIPE_ENABLED) {
  console.warn(
    '⚠️ Stripe keys missing. Payments route mounted but checkout may fail.'
  );
}

// ✅ health check
app.get('/', (req, res) => {
  res.send('Backend running OK');
});

// ✅ global error handler
app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err);
  res.status(500).json({ message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI missing in env');
      process.exit(1);
    }
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET missing in env');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );
  } catch (err) {
    console.error('❌ Mongo connect error:', err);
    process.exit(1);
  }
}

start();
