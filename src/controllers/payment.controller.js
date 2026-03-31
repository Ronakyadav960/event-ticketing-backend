const Stripe = require('stripe');
const mongoose = require('mongoose');

const StripeOrder = require('../models/StripeOrder');
const Booking = require('../models/Booking');
const Event = require('../models/Event');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY missing in environment');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ================= HELPER FUNCTIONS ================= */

function generateTicketId() {
  return `TKT-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`.toUpperCase();
}

function mustBeInt(n) {
  return Number.isInteger(n) && n > 0;
}

function toObjectIdOrNull(id) {
  try {
    if (!id) return null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      return new mongoose.Types.ObjectId(id);
    }
    return null;
  } catch {
    return null;
  }
}

function parseShowAt(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getEventTimeZone() {
  return (process.env.EVENT_TIMEZONE || 'Asia/Kolkata').trim() || 'Asia/Kolkata';
}

function yyyyMmDdInTz(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function hhmmInTz(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.hour}:${map.minute}`;
}

function isShowTimeAllowed(eventDoc, showAt) {
  if (!eventDoc || !showAt) return true;

  const start = eventDoc.startDate ? new Date(eventDoc.startDate) : null;
  const end = eventDoc.endDate ? new Date(eventDoc.endDate) : null;
  const times = Array.isArray(eventDoc.showTimes) ? eventDoc.showTimes : [];
  const tz = getEventTimeZone();

  if (start && !Number.isNaN(start.getTime())) {
    const showDateOnly = new Date(`${yyyyMmDdInTz(showAt, tz)}T00:00:00.000Z`);
    if (showDateOnly.getTime() < start.getTime()) return false;
    if (end && !Number.isNaN(end.getTime()) && showDateOnly.getTime() > end.getTime()) {
      return false;
    }
  }

  if (times.length) {
    const hhmm = hhmmInTz(showAt, tz);
    if (!times.includes(hhmm)) return false;
  }

  return true;
}

/* ================= FINALIZE LOGIC ================= */

async function finalizePaidOrder({ order, session }) {
  if (order.ticketId && order.bookingId) {
    return {
      status: 'READY',
      ticketId: order.ticketId,
      bookingId: order.bookingId,
    };
  }

  const seats = Number(order.quantity || 0);
  if (!seats || seats < 1) {
    order.status = 'FAILED';
    await order.save();
    return { status: 'FAILED', message: 'Invalid seats.' };
  }

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
    await order.save();
    return { status: 'FAILED', message: 'Not enough seats available.' };
  }

  const ticketId = generateTicketId();

  try {
    const booking = await Booking.create({
      user: toObjectIdOrNull(order.userId) || order.userId,
      event: toObjectIdOrNull(order.eventId) || order.eventId,
      name: order.name || '',
      email: order.email || '',
      seats,
      registrationTemplate: order.registrationTemplate || 'standard',
      registrationData: order.registrationData || {},
      ticketId,
      paymentStatus: 'PAID',
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
      showAt: order.showAt || null,
    });

    order.status = 'PAID';
    order.bookingId = booking._id;
    order.ticketId = ticketId;
    order.paymentStatus = 'paid';
    order.stripePaymentIntentId = session.payment_intent || null;

    await order.save();

    return { status: 'READY', ticketId };
  } catch (err) {
    await Event.findByIdAndUpdate(order.eventId, {
      $inc: { bookedSeats: -seats },
    });
    throw err;
  }
}

/* ================= POLLING ================= */

exports.getStripeResultBySession = async (req, res) => {
  try {
    const { sessionId } = req.params;

    const order = await StripeOrder.findOne({ stripeSessionId: sessionId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Stripe order not found',
      });
    }

    if (order.ticketId) {
      return res.json({
        success: true,
        status: 'READY',
        ticketId: order.ticketId,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return res.json({
        success: true,
        status: 'PENDING',
      });
    }

    const result = await finalizePaidOrder({ order, session });

    return res.json({
      success: true,
      status: result.status,
      ticketId: result.ticketId || null,
    });
  } catch (err) {
    console.error('❌ Polling error:', err);
    return res.status(500).json({ message: err.message });
  }
};

/* ================= CREATE CHECKOUT ================= */

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
      registrationTemplate,
      registrationData,
      showAt,
    } = req.body;

    if (!mustBeInt(quantity))
      return res.status(400).json({ message: 'Invalid quantity' });

    if (!mustBeInt(Number(unitAmount)))
      return res.status(400).json({ message: 'Invalid unitAmount' });

    const showAtDate = parseShowAt(showAt);

    // ✅ block booking for past events (use selected showAt if provided)
    const eventDoc = await Event.findById(eventId).select('date startDate endDate showTimes');
    if (!eventDoc) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const effectiveShowAt = showAtDate || (eventDoc.date ? new Date(eventDoc.date) : null);
    if (!effectiveShowAt || Number.isNaN(effectiveShowAt.getTime())) {
      return res.status(400).json({ message: 'Invalid show date/time' });
    }

    if (effectiveShowAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Cannot book past events' });
    }

    if (!isShowTimeAllowed(eventDoc, effectiveShowAt)) {
      return res.status(400).json({ message: 'Selected show date/time not available' });
    }

    const order = await StripeOrder.create({
      userId: req.user?.id || null,
      eventId,
      ticketName,
      name,
      email,
      registrationTemplate: registrationTemplate || 'standard',
      registrationData: registrationData || {},
      showAt: effectiveShowAt,
      quantity,
      unitAmount: Number(unitAmount),
      currency: currency.toLowerCase(),
      status: 'PENDING',
    });

    // ✅ Frontend base URL (prefer env, fallback to first CLIENT_URL)
    const clientEnv = (process.env.CLIENT_URL || '').split(',')[0]?.trim();
    const BASE_URL = (process.env.FRONTEND_URL || clientEnv || 'http://localhost:4200')
      .replace(/\/+$/, '');

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: ticketName },
            unit_amount: Number(unitAmount),
          },
          quantity: Number(quantity),
        },
      ],
      success_url: `${BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/payment-cancel`,
      metadata: {
        orderId: String(order._id),
      },
    });

    order.stripeSessionId = session.id;
    await order.save();

    return res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Stripe create error:', err);
    return res.status(500).json({
      message: err.message,
      type: err.type,
      code: err.code,
    });
  }
};

/* ================= WEBHOOK ================= */

exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;

    if (orderId) {
      const order = await StripeOrder.findById(orderId);
      if (order && session.payment_status === 'paid') {
        await finalizePaidOrder({ order, session });
      }
    }
  }

  res.json({ received: true });
};
