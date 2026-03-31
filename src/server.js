// server.js ✅ FINAL STABLE VERSION (No CORS crash)

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

/* ======================================================
   TRUST PROXY (Render / Vercel)
====================================================== */

app.set('trust proxy', 1);

/* ======================================================
   SIMPLE & SAFE CORS (NO CRASH)
====================================================== */

app.use(
  cors({
    origin: true, // allow all origins dynamically
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

/* ======================================================
   STRIPE WEBHOOK RAW BODY
   Must be registered BEFORE express.json(), otherwise signature verification fails.
====================================================== */

app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

/* ======================================================
   BODY PARSERS
====================================================== */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ======================================================
   STATIC FILES
====================================================== */

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.disable('etag');

/* ======================================================
   NO CACHE (optional but good)
====================================================== */

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

/* ======================================================
   ROUTES
====================================================== */

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/bookings', require('./routes/booking.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/payments', require('./routes/payment.routes'));
app.use('/api/hero-images', require('./routes/heroImage.routes'));

/* ======================================================
   HEALTH CHECK
====================================================== */

app.get('/', (req, res) => {
  res.send('✅ Backend running OK');
});

/* ======================================================
   GLOBAL ERROR HANDLER
====================================================== */

app.use((err, req, res, next) => {
  console.error('🔥 Server Error:', err);
  res.status(500).json({
    message: err.message || 'Internal Server Error',
  });
});

/* ======================================================
   START SERVER
====================================================== */

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    if (!process.env.MONGO_URI) {
      console.error('❌ MONGO_URI missing');
      process.exit(1);
    }

    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET missing');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

start();
