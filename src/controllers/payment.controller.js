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
      ticketId,
      paymentStatus: 'PAID',
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
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
    } = req.body;

    if (!mustBeInt(quantity))
      return res.status(400).json({ message: 'Invalid quantity' });

    if (!mustBeInt(Number(unitAmount)))
      return res.status(400).json({ message: 'Invalid unitAmount' });

    const order = await StripeOrder.create({
      userId: req.user?.id || null,
      eventId,
      ticketName,
      name,
      email,
      quantity,
      unitAmount: Number(unitAmount),
      currency: currency.toLowerCase(),
      status: 'PENDING',
    });

    // 🔥 HARD FIXED PRODUCTION URL (No dynamic origin)
    const BASE_URL =
      'https://event-ticketing-frontend-hjlg.vercel.app';

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
