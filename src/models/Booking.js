const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },

    // ✅ NEW: store booking details used for fixed-quantity ticketing
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    seats: { type: Number, required: true, min: 1, default: 1 },
    registrationTemplate: { type: String, default: 'standard' },
    registrationData: { type: mongoose.Schema.Types.Mixed, default: {} },

    ticketId: {
      type: String,
      required: true,
      unique: true,
    },

    // ✅ NEW: helpful for Stripe/webhook-based booking
    paymentStatus: { type: String, default: 'PENDING' }, // PENDING | PAID | FAILED
    stripeSessionId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },

    // New: selected show date/time (for multi-day events)
    // Stored as a single datetime for easy display/filtering.
    showAt: { type: Date, default: null },

    bookedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Booking', bookingSchema);
