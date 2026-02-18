// src/models/Event.js
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    title: { 
      type: String, 
      required: true, 
      trim: true 
    },

    description: { 
      type: String, 
      default: "" 
    },

    date: { 
      type: Date, 
      required: true 
    },

    venue: { 
      type: String, 
      required: true, 
      trim: true 
    },

    price: { 
      type: Number, 
      required: true, 
      min: 0 
    },

    totalSeats: { 
      type: Number, 
      required: true, 
      min: 1 
    },

    bookedSeats: { 
      type: Number, 
      default: 0, 
      min: 0 
    },

    // ✅ Creator Ownership (VERY IMPORTANT)
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ event photo (GridFS or path)
    imageUrl: { 
      type: String, 
      default: "" 
    },

    imageFileId: { 
      type: mongoose.Schema.Types.ObjectId, 
      default: null 
    },

  },
  { 
    timestamps: true, 
    toJSON: { virtuals: true }, 
    toObject: { virtuals: true } 
  }
);


// =============================
// 🔹 Virtual: Available Seats
// =============================
eventSchema.virtual("availableSeats").get(function () {
  const total = Number(this.totalSeats || 0);
  const booked = Number(this.bookedSeats || 0);
  return Math.max(total - booked, 0);
});


// =============================
// 🔹 Safety Check Before Save
// =============================
eventSchema.pre("save", function () {
  if (this.bookedSeats > this.totalSeats) {
    this.bookedSeats = this.totalSeats;
  }

  if (this.bookedSeats < 0) {
    this.bookedSeats = 0;
  }
});


module.exports = mongoose.model("Event", eventSchema);
