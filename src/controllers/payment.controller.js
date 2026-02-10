// controllers/payment.controller.js ✅ UPDATED (auto-finalize on success polling)
const Stripe = require('stripe');
const mongoose = require('mongoose');

const StripeOrder = require('../models/StripeOrder');
const Booking = require('../models/Booking');
const Event = require('../models/Event');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ helper: generate unique ticket id
function generateTicketId() {
  return `TKT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
}

function mustBeInt(n) {
  return Number.isInteger(n) && n > 0;
}

// ✅ Safe ObjectId helper (won't throw)
function toObjectIdOrNull(id) {
  try {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
    return null;
  } catch {
    return null;
  }
}

/**
 * ✅ Finalize order (idempotent)
 * - Atomic seat increment with availability check
 * - Create booking
 * - Save ticketId + bookingId in StripeOrder
 * - Rollback seats if booking creation fails
 */
async function finalizePaidOrder({ order, session }) {
  // If already finalized, return ready
  if (order.ticketId && order.bookingId) {
    return { status: 'READY', ticketId: order.ticketId, bookingId: order.bookingId };
  }

  const seats = Number(order.quantity || 0);
  if (!seats || seats < 1) {
    order.status = 'FAILED';
    order.paymentStatus = session?.payment_status || order.paymentStatus || 'paid';
    order.stripePaymentIntentId = session?.payment_intent || order.stripePaymentIntentId || null;
    await order.save();
    return { status: 'FAILED', message: 'Invalid seats.' };
  }

  // ✅ ATOMIC seat increment with availability check
  const updatedEvent = await Event.findOneAndUpdate(
    {
      _id: order.eventId,
      $expr: { $lte: [{ $add: ['$bookedSeats', seats] }, '$totalSeats'] },
    },
    { $inc: { bookedSeats: seats } },
    { new: true }
  );

  if (!updatedEvent) {
    order.status = 'FAILED';
    order.paymentStatus = session?.payment_status || order.paymentStatus || 'paid';
    order.stripePaymentIntentId = session?.payment_intent || order.stripePaymentIntentId || null;
    await order.save();
    return { status: 'FAILED', message: 'Not enough seats available.' };
  }

  const ticketId = generateTicketId();

  // Booking schema may want ObjectId
  const safeUserObjId = toObjectIdOrNull(order.userId);
  const safeEventObjId = toObjectIdOrNull(order.eventId);

  try {
    const booking = await Booking.create({
      user: safeUserObjId || order.userId,     // fallback if schema is String
      event: safeEventObjId || order.eventId,  // fallback if schema is String
      name: order.name || session?.metadata?.name || '',
      email: order.email || session?.metadata?.email || '',
      seats,
      ticketId,
      paymentStatus: 'PAID',
      stripeSessionId: order.stripeSessionId || session?.id || null,
      stripePaymentIntentId: session?.payment_intent || null,
    });

    order.status = 'PAID';
    order.paymentStatus = session?.payment_status || 'paid';
    order.stripePaymentIntentId = session?.payment_intent || null;
    order.bookingId = booking._id;
    order.ticketId = ticketId;
    await order.save();

    return { status: 'READY', ticketId, bookingId: booking._id };
  } catch (bookingErr) {
    // ✅ rollback seats
    await Event.findByIdAndUpdate(order.eventId, { $inc: { bookedSeats: -seats } });

    order.status = 'FAILED';
    order.paymentStatus = session?.payment_status || order.paymentStatus || 'paid';
    order.stripePaymentIntentId = session?.payment_intent || order.stripePaymentIntentId || null;
    await order.save();

    throw bookingErr;
  }
}

// ✅ GET /api/payments/stripe/session/:sessionId
// used by Angular PaymentSuccess page to redirect to /booking/:ticketId
exports.getStripeResultBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    // IMPORTANT: do NOT use .lean() because we may need to save()
    const order = await StripeOrder.findOne({ stripeSessionId: sessionId });

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 'NOT_FOUND',
        message: 'Stripe order not found for this session.',
      });
    }

    // Already ready
    if (order.ticketId) {
      return res.json({
        success: true,
        status: 'READY',
        ticketId: order.ticketId,
        bookingId: order.bookingId || null,
      });
    }

    // If order already failed/expired
    if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(order.status)) {
      return res.json({
        success: true,
        status: order.status,
        message: `Order ${order.status.toLowerCase()}.`,
      });
    }

    // ✅ Fallback: ask Stripe directly (solves webhook delay / not firing in localhost)
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Not paid yet => keep polling
    if (session?.payment_status !== 'paid') {
      return res.json({
        success: true,
        status: 'PENDING',
        message: 'Payment not confirmed yet.',
      });
    }

    // Payment is paid: finalize now (idempotent)
    const result = await finalizePaidOrder({ order, session });

    if (result.status === 'READY') {
      return res.json({
        success: true,
        status: 'READY',
        ticketId: result.ticketId,
        bookingId: result.bookingId || null,
      });
    }

    return res.json({
      success: true,
      status: result.status,
      message: result.message || 'Unable to finalize booking.',
    });
  } catch (err) {
    console.error('❌ getStripeResultBySession error:', err);
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      message: err?.message || 'Server error',
    });
  }
};

// POST /api/payments/create-checkout-session
exports.createCheckoutSession = async (req, res) => {
  try {
    const {
      eventId,
      ticketName,
      quantity,
      unitAmount,
      currency = 'inr',
      name,
      email,
    } = req.body;

    // ✅ always trust JWT, never frontend
    const userId = req.user?.id;

    if (!eventId) return res.status(400).json({ message: 'eventId is required' });
    if (!ticketName) return res.status(400).json({ message: 'ticketName is required' });
    if (!mustBeInt(quantity)) return res.status(400).json({ message: 'quantity must be a positive integer' });
    if (!mustBeInt(unitAmount)) return res.status(400).json({ message: 'unitAmount must be a positive integer (in paise)' });

    // ✅ Optional: early availability check (final check happens in webhook/finalize)
    const ev = await Event.findById(eventId).select('totalSeats bookedSeats');
    if (!ev) return res.status(404).json({ message: 'Event not found' });

    const available = Math.max((ev.totalSeats || 0) - (ev.bookedSeats || 0), 0);
    if (available < quantity) return res.status(400).json({ message: 'Not enough seats available' });

    // ✅ Create StripeOrder record in Mongo first (PENDING)
    const order = await StripeOrder.create({
      userId: userId || null,
      eventId: String(eventId),
      ticketName: String(ticketName),
      name: name || '',
      email: email || '',
      quantity,
      unitAmount,
      currency,
      status: 'PENDING',
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: ticketName },
            unit_amount: unitAmount,
          },
          quantity,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment-cancel`,
      metadata: {
        orderId: String(order._id),
        eventId: String(eventId),
        userId: userId ? String(userId) : '',
        name: name || '',
        email: email || '',
      },
    });

    order.stripeSessionId = session.id;
    await order.save();

    return res.json({ url: session.url, orderId: order._id });
  } catch (err) {
    console.error('❌ createCheckoutSession error:', err);
    return res.status(500).json({
      message: err?.message || 'Failed to create checkout session',
      type: err?.type,
      code: err?.code,
      raw: err?.raw?.message,
    });
  }
};

// POST /api/payments/webhook
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw buffer (server.js configured)
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const orderId = session?.metadata?.orderId;
      if (!orderId) return res.json({ received: true });

      const order = await StripeOrder.findById(orderId);
      if (!order) return res.json({ received: true });

      // ✅ Idempotency
      if (order.status === 'PAID' && order.bookingId && order.ticketId) {
        return res.json({ received: true });
      }

      // If polling already finalized it, status might be PAID but ticketId missing (rare)
      // We'll still try finalize safely (it is idempotent with checks)
      if (session?.payment_status === 'paid') {
        try {
          await finalizePaidOrder({ order, session });
        } catch (e) {
          console.error('❌ Webhook finalize error:', e);
          // we still return received true to Stripe to avoid retries storm
        }
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;

      if (orderId) {
        const order = await StripeOrder.findById(orderId);
        if (order && order.status === 'PENDING') {
          order.status = 'EXPIRED';
          await order.save();
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('❌ Webhook handler error:', err);
    return res.status(500).json({ message: 'Webhook handler failed' });
  }
};
