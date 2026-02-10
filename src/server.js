// server.js ✅ UPDATED FILE (Stripe webhook-safe + no-crash if Stripe env missing)
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ✅ CORS (Angular dev server)
app.use(
  cors({
    origin: ['http://localhost:4200'],
    credentials: true,
  })
);

// ✅ IMPORTANT: Stripe webhook needs RAW body, so mount raw parser ONLY for webhook route BEFORE json()
// (but only if payments routes are enabled)
const STRIPE_ENABLED = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
if (STRIPE_ENABLED) {
  app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve uploaded images
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ✅ Disable ETag so Express never replies with 304 for API
app.disable('etag');

// ✅ Force no-cache headers for all API responses
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
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

// ✅ Stripe payments routes (enable only if env present)
if (STRIPE_ENABLED) {
  app.use('/api/payments', require('./routes/payment.routes'));
} else {
  console.warn('⚠️ Stripe disabled: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing. Payments routes not mounted.');
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
      console.error('❌ MONGO_URI missing in .env');
      process.exit(1);
    }
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET missing in .env');
      process.exit(1);
    }

    // ✅ CLIENT_URL only used for Stripe flows; warn only
    if (!process.env.CLIENT_URL) {
      console.warn('⚠️ CLIENT_URL missing in .env (recommended: http://localhost:4200)');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ Mongo connect error:', err);
    process.exit(1);
  }
}

start();
