const express = require('express');
const router = express.Router();

const path = require('path');
const multer = require('multer');

const User = require('../models/User');
const Event = require('../models/Event');
const Booking = require('../models/Booking');

const { protect, admin } = require('../middlewares/auth.middleware');

// ✅ Multer setup (uploads folder)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `event-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// =======================
// 📌 USERS (ADMIN)
// =======================
router.get('/users', protect, admin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users', error: err.message });
  }
});

// =======================
// 📌 EVENTS (ADMIN)
// =======================

// 🔍 GET ALL EVENTS
router.get('/events', protect, admin, async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch events', error: err.message });
  }
});

// ✅ GET SINGLE EVENT (for edit)
router.get('/events/:id', protect, admin, async (req, res) => {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).json({ message: 'Event not found' });
    res.json(ev);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch event', error: err.message });
  }
});

// ✅ UPDATE EVENT (IMPORTANT: multer for FormData)
router.put('/events/:id', protect, admin, upload.single('image'), async (req, res) => {
  try {
    const id = req.params.id;

    const ev = await Event.findById(id);
    if (!ev) return res.status(404).json({ message: 'Event not found' });

    // ✅ req.body comes as strings in multipart
    const {
      title,
      description,
      date,
      venue,
      price,
      totalSeats,
      // bookedSeats (DON'T allow reset here)
    } = req.body;

    if (title !== undefined) ev.title = String(title).trim();
    if (description !== undefined) ev.description = String(description || '');
    if (date !== undefined) ev.date = new Date(date);
    if (venue !== undefined) ev.venue = String(venue).trim();

    if (price !== undefined) ev.price = Number(price);
    if (totalSeats !== undefined) ev.totalSeats = Number(totalSeats);

    // ✅ If new image uploaded, update imageUrl
    if (req.file) {
      ev.imageUrl = `/uploads/${req.file.filename}`;
    }

    // ✅ Safety: if totalSeats decreased below bookedSeats, clamp
    if (ev.bookedSeats > ev.totalSeats) {
      ev.bookedSeats = ev.totalSeats;
    }
    if (ev.bookedSeats < 0) ev.bookedSeats = 0;

    await ev.save();

    return res.json({ message: 'Event updated successfully', event: ev });
  } catch (err) {
    console.error('ADMIN UPDATE EVENT ERROR ❌', err);
    return res.status(500).json({
      message: 'Failed to update event',
      error: err.message,
    });
  }
});

// ❌ DELETE EVENT
router.delete('/events/:id', protect, admin, async (req, res) => {
  try {
    const deleted = await Event.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Event not found' });
    res.json({ message: 'Event deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete event', error: err.message });
  }
});

// =======================
// 📌 BOOKINGS (ADMIN)
// =======================

// 🔍 GET ALL BOOKINGS
router.get('/bookings', protect, admin, async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('user', 'name email')
      .populate('event', 'title date')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
});

// ❌ DELETE BOOKING
router.delete('/bookings/:id', protect, admin, async (req, res) => {
  try {
    const deleted = await Booking.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Booking not found' });
    res.json({ message: 'Booking deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete booking', error: err.message });
  }
});

module.exports = router;
