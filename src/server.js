// server.js ✅ UPDATED for Render + Cloudflare Pages (CORS fixed)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ✅ Render/Cloudflare behind proxy (good practice)
app.set('trust proxy', 1);

// ✅ CORS (ALLOW Cloudflare Pages + local)
// Put your Cloudflare Pages URL in CLIENT_URL on Render, example:
// CLIENT_URL=https://your-site.pages.dev
const allowedOrigins = [
  'http://localhost:4200',
  process.env.CLIENT_URL, // ✅ Cloudflare Pages url
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // allow non-browser requests (like curl/postman) with no origin
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
  })
);

// ✅ Preflight handling (important for browsers)
app.options('*', cors({ origin: allowedOrigins, credentials: true }));

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
