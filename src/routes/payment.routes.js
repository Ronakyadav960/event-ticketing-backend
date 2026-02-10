const express = require('express');
const router = express.Router();

const {
  createCheckoutSession,
  stripeWebhook,
  getStripeResultBySession, // ✅ ADD THIS
} = require('../controllers/payment.controller');

const { protect } = require('../middlewares/auth.middleware');

// ✅ PROTECT checkout session so req.user is always available
router.post('/create-checkout-session', protect, createCheckoutSession);

// ❌ webhook must NOT be protected (Stripe has no JWT)
router.post('/webhook', stripeWebhook);

// ✅ Stripe success polling (PaymentSuccess page)
router.get('/stripe/session/:sessionId', getStripeResultBySession);

module.exports = router;
