// controllers/event.controller.js
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const crypto = require('crypto');
const path = require('path');

const Event = require('../models/Event');

// =======================
// GridFS Helper
// =======================
function getBucket() {
  if (!mongoose.connection?.db) return null;
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'eventImages' });
}

// =======================
// URL Helpers
// =======================
function getBaseUrl(req) {
  const envBase = (process.env.BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function buildImagePath(eventId) {
  return `/api/events/${eventId}/image`;
}

// =======================
// Upload Buffer to GridFS
// =======================
async function uploadBufferToGridFS(file) {
  const bucket = getBucket();
  if (!bucket) throw new Error('MongoDB not connected');

  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const rand = crypto.randomBytes(16).toString('hex');
  const filename = `event-${Date.now()}-${rand}${ext}`;

  return await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.mimetype,
    });

    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));

    uploadStream.end(file.buffer);
  });
}

// =======================
// CREATE EVENT
// =======================
exports.createEvent = async (req, res) => {
  try {
    if (!req.user || !['creator', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Not authorized to create events' });
    }

    const { title, description, date, venue, price, totalSeats } = req.body;

    if (!title || !date || !venue || price == null || totalSeats == null) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    let imageFileId = null;

    if (req.file) {
      imageFileId = await uploadBufferToGridFS(req.file);
    }

    const event = await Event.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      date: new Date(date),
      venue: String(venue).trim(),
      price: Number(price),
      totalSeats: Number(totalSeats),
      bookedSeats: 0,
      createdBy: req.user.id, // 🔥 ownership
      imageFileId,
      imageUrl: imageFileId ? buildImagePath(undefined) : '',
    });

    if (imageFileId) {
      event.imageUrl = buildImagePath(event._id);
      await event.save();
    }

    return res.status(201).json(event);

  } catch (error) {
    console.error('CREATE EVENT ERROR ❌', error);
    return res.status(500).json({ message: 'Server error while creating event' });
  }
};

// =======================
// GET ALL EVENTS (PUBLIC)
// =======================
exports.getAllEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ date: 1 });
    return res.json(events);
  } catch (error) {
    console.error('GET ALL EVENTS ERROR ❌', error);
    return res.status(500).json({ message: 'Failed to fetch events' });
  }
};

// =======================
// GET MY EVENTS (CREATOR)
// =======================
exports.getMyEvents = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'creator') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const events = await Event.find({ createdBy: req.user.id });
    return res.json(events);

  } catch (error) {
    console.error('GET MY EVENTS ERROR ❌', error);
    return res.status(500).json({ message: 'Failed to fetch events' });
  }
};

// =======================
// GET EVENT BY ID
// =======================
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    return res.json(event);

  } catch (error) {
    console.error('GET EVENT BY ID ERROR ❌', error);
    return res.status(400).json({ message: 'Invalid event ID' });
  }
};

// =======================
// UPDATE EVENT
// =======================
exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    // 🔒 Ownership Check
    if (
      req.user.role === 'creator' &&
      event.createdBy.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: 'Not authorized to update this event' });
    }

    if (req.body.title != null) event.title = String(req.body.title).trim();
    if (req.body.description != null) event.description = String(req.body.description).trim();
    if (req.body.date != null) event.date = new Date(req.body.date);
    if (req.body.venue != null) event.venue = String(req.body.venue).trim();
    if (req.body.price != null) event.price = Number(req.body.price);
    if (req.body.totalSeats != null) event.totalSeats = Number(req.body.totalSeats);

    if (req.file) {
      const newId = await uploadBufferToGridFS(req.file);
      event.imageFileId = newId;
      event.imageUrl = buildImagePath(event._id);
    }

    await event.save();
    return res.json(event);

  } catch (error) {
    console.error('UPDATE EVENT ERROR ❌', error);
    return res.status(400).json({ message: 'Update failed' });
  }
};

// =======================
// DELETE EVENT
// =======================
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (
      req.user.role === 'creator' &&
      event.createdBy.toString() !== req.user.id
    ) {
      return res.status(403).json({ message: 'Not authorized to delete this event' });
    }

    await event.deleteOne();
    return res.json({ message: 'Event deleted successfully' });

  } catch (error) {
    console.error('DELETE EVENT ERROR ❌', error);
    return res.status(400).json({ message: 'Delete failed' });
  }
};

// =======================
// BOOK SEATS (USER)
// =======================
exports.bookSeats = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Login required' });
    }

    const seats = Number(req.body.seats);

    if (!seats || seats < 1) {
      return res.status(400).json({ message: 'Seats must be at least 1' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const remaining = event.totalSeats - event.bookedSeats;

    if (seats > remaining) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    event.bookedSeats += seats;
    await event.save();

    return res.json({
      message: 'Seats booked successfully',
      bookedSeats: event.bookedSeats,
      remainingSeats: event.totalSeats - event.bookedSeats,
    });

  } catch (error) {
    console.error('BOOK SEATS ERROR ❌', error);
    return res.status(500).json({ message: 'Booking failed' });
  }
};
