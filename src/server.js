// server.js ✅ UPDATED for Render + Vercel/Cloudflare (CORS fixed)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ✅ Render/Vercel behind proxy (good practice)
app.set('trust proxy', 1);

/**
 * ✅ CORS
 * Render env me CLIENT_URL set karo (comma separated allowed):
 * CLIENT_URL=https://event-ticketing-frontend-hjlg.vercel.app,https://your.pages.dev,http://localhost:4200
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
      // allow non-browser requests (curl/postman) with no origin
      if (!origin) return cb(null, true);

      // allow only whitelisted origins
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // ❗ IMPORTANT: error throw mat karo, warna preflight me headers nahi jaate
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ✅ Preflight handling (Express/path-to-regexp safe)
app.options(/.*/, cors());

// ✅ Stripe webhook needs RAW body BEFORE json()
const STRIPE_ENABLED = !!(
  process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
);
if (STRIPE_ENABLED) {
  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve uploaded images (NOTE: Render disk is ephemeral; GridFS is better)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.disable('etag');

// optional cache headers (fine)
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

// routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

if (STRIPE_ENABLED) {
  app.use('/api/payments', require('./routes/payment.routes'));
} else {
  console.warn(
    '⚠️ Stripe disabled: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing. Payments routes not mounted.'
  );
}

// health check
app.get('/', (req, res) => {
  res.send('Backend running OK');
});

// global error handler
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

    // ✅ Connect (works with mongoose 6/7/8)
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Mongo connect error:', err);
    process.exit(1);
  }
}

start();
