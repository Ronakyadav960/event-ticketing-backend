const mongoose = require('mongoose');

const heroImageSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    path: { type: String, required: true }, // e.g. /uploads/hero/<filename>
  },
  { timestamps: true }
);

module.exports = mongoose.model('HeroImage', heroImageSchema);

