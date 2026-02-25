// src/models/Event.js
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      default: "",
      maxlength: 2000,
    },

    date: {
      type: Date,
      required: true,
    },

    venue: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    price: {
      type: Number,
      required: true,
      min: 0,
    },

    totalSeats: {
      type: Number,
      required: true,
      min: 1,
    },

    bookedSeats: {
      type: Number,
      default: 0,
      min: 0,
    },

    // 🔥 VERY IMPORTANT FOR DASHBOARD FILTERING
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Image (GridFS or relative path)
    imageUrl: {
      type: String,
      default: "",
    },

    imageFileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =====================================================
// 🔹 INDEXES (Important for performance)
// =====================================================
eventSchema.index({ createdBy: 1 });
eventSchema.index({ date: 1 });


// =====================================================
// 🔹 Virtual: Available Seats
// =====================================================
eventSchema.virtual("availableSeats").get(function () {
  const total = Number(this.totalSeats || 0);
  const booked = Number(this.bookedSeats || 0);
  return Math.max(total - booked, 0);
});


// =====================================================
// 🔹 Virtual: Sold Out
// =====================================================
eventSchema.virtual("isSoldOut").get(function () {
  return this.availableSeats <= 0;
});


// =====================================================
// 🔹 Safety Before Save
// =====================================================
eventSchema.pre("save", function () {
  if (this.bookedSeats > this.totalSeats) {
    this.bookedSeats = this.totalSeats;
  }

  if (this.bookedSeats < 0) {
    this.bookedSeats = 0;
  }
});


// =====================================================
// 🔹 Clean Response Transformation (optional)
// =====================================================
eventSchema.set("toJSON", {
  transform: function (doc, ret) {
    ret.id = ret._id;
    delete ret.__v;
    return ret;
  },
});


module.exports = mongoose.model("Event", eventSchema);
