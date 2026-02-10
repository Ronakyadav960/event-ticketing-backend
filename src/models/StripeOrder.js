// models/StripeOrder.js ✅ UPDATED FILE
const mongoose = require('mongoose');

const StripeOrderSchema = new mongoose.Schema(
  {
    userId: { type: String, default: null }, // will be set from JWT on server
    eventId: { type: String, required: true },
    ticketName: { type: String, required: true },

    // ✅ store buyer info (optional)
    name: { type: String, default: '' },
    email: { type: String, default: '' },

    // quantity = seats
    quantity: { type: Number, required: true },
    unitAmount: { type: Number, required: true }, // smallest unit: paise
    currency: { type: String, default: 'inr' },

    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED'],
      default: 'PENDING',
    },

    paymentStatus: { type: String, default: null },

    stripeSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },

    // ✅ link created booking (idempotency + easy lookup)
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    ticketId: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StripeOrder', StripeOrderSchema);
