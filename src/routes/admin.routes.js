const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Event = require('../models/Event');
const Booking = require('../models/Booking');

const { protect, authorizeRoles } = require('../middlewares/auth.middleware');



// =================================================
// ================= SUPERADMIN ====================
// =================================================

// 🔹 Get All Users (Superadmin Only)
router.get('/users', protect, authorizeRoles('superadmin'), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// 🔹 Get All Bookings (Superadmin Only)
router.get('/bookings', protect, authorizeRoles('superadmin'), async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('user', 'name email')
      .populate('event', 'title');
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings' });
  }
});


// =================================================
// ================= CREATOR =======================
// =================================================

// 🔹 Get My Events (Creator)
router.get('/my-events', protect, authorizeRoles('creator'), async (req, res) => {
  try {
    const events = await Event.find({ createdBy: req.user.id });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch events' });
  }
});

// 🔹 Update My Event
router.put('/events/:id', protect, authorizeRoles('creator', 'superadmin'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) return res.status(404).json({ message: 'Event not found' });

    // If creator → allow only own event
    if (req.user.role === 'creator' && event.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    Object.assign(event, req.body);
    await event.save();

    res.json({ message: 'Event updated', event });
  } catch (err) {
    res.status(500).json({ message: 'Update failed' });
  }
});

// 🔹 Delete My Event
router.delete('/events/:id', protect, authorizeRoles('creator', 'superadmin'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (req.user.role === 'creator' && event.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    await event.deleteOne();
    res.json({ message: 'Event deleted' });

  } catch (err) {
    res.status(500).json({ message: 'Delete failed' });
  }
});


// 🔹 Creator → See Only Bookings of Their Events
router.get('/my-bookings', protect, authorizeRoles('creator'), async (req, res) => {
  try {
    const myEvents = await Event.find({ createdBy: req.user.id }).select('_id');

    const eventIds = myEvents.map(e => e._id);

    const bookings = await Booking.find({ event: { $in: eventIds } })
      .populate('user', 'name email')
      .populate('event', 'title');

    res.json(bookings);

  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings' });
  }
});

module.exports = router;
