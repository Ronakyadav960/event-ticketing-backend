// controllers/event.controller.js
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
const crypto = require('crypto');
const path = require('path');

const Event = require('../models/Event');

function getBucket() {
  if (!mongoose.connection?.db) return null;
  return new GridFSBucket(mongoose.connection.db, { bucketName: 'eventImages' });
}

function buildImageUrl(req, eventId) {
  return `${req.protocol}://${req.get('host')}/api/events/${eventId}/image`;
}

// ✅ upload buffer to GridFS manually (no multer-gridfs-storage)
async function uploadBufferToGridFS(file) {
  const bucket = getBucket();
  if (!bucket) throw new Error('MongoDB not connected');

  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const rand = crypto.randomBytes(16).toString('hex');
  const filename = `event-${Date.now()}-${rand}${ext}`;

  return await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      contentType: file.mimetype,
      metadata: {
        originalName: file.originalname,
        mimeType: file.mimetype,
      },
    });

    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));

    uploadStream.end(file.buffer);
  });
}

// =======================
// CREATE EVENT (ADMIN)
// =======================
exports.createEvent = async (req, res) => {
  try {
    const { title, description, date, venue, price, totalSeats } = req.body;

    if (!title || !date || !venue || price == null || totalSeats == null) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    let imageFileId = null;

    // ✅ if image uploaded, store in GridFS
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
      imageFileId,
      imageUrl: imageFileId ? buildImageUrl(req, null) : '',
    });

    // now we have event._id so finalize imageUrl
    if (imageFileId) {
      event.imageUrl = buildImageUrl(req, event._id);
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

    const mapped = events.map((ev) => {
      const obj = ev.toObject();
      if (obj.imageFileId && !obj.imageUrl) {
        obj.imageUrl = buildImageUrl(req, obj._id);
      }
      return obj;
    });

    return res.json(mapped);
  } catch (error) {
    console.error('GET ALL EVENTS ERROR ❌', error);
    return res.status(500).json({ message: 'Failed to fetch events' });
  }
};

// =======================
// GET EVENT BY ID (PUBLIC)
// =======================
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const obj = event.toObject();
    if (obj.imageFileId && !obj.imageUrl) {
      obj.imageUrl = buildImageUrl(req, obj._id);
    }

    return res.json(obj);
  } catch (error) {
    console.error('GET EVENT BY ID ERROR ❌', error);
    return res.status(400).json({ message: 'Invalid event ID' });
  }
};

// =======================
// UPDATE EVENT (ADMIN)
// =======================
exports.updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    if (req.body.title != null) event.title = String(req.body.title).trim();
    if (req.body.description != null) event.description = String(req.body.description).trim();
    if (req.body.date != null) event.date = new Date(req.body.date);
    if (req.body.venue != null) event.venue = String(req.body.venue).trim();
    if (req.body.price != null) event.price = Number(req.body.price);
    if (req.body.totalSeats != null) event.totalSeats = Number(req.body.totalSeats);

    // ✅ if new image uploaded -> upload to GridFS and replace old
    if (req.file) {
      const newId = await uploadBufferToGridFS(req.file);

      // (optional) delete old image from GridFS
      if (event.imageFileId) {
        try {
          const bucket = getBucket();
          bucket && (await bucket.delete(new mongoose.Types.ObjectId(event.imageFileId)));
        } catch (e) {
          // ignore delete failures
        }
      }

      event.imageFileId = newId;
      event.imageUrl = buildImageUrl(req, event._id);
    }

    const updated = await event.save();
    return res.json(updated);
  } catch (error) {
    console.error('UPDATE EVENT ERROR ❌', error);
    return res.status(400).json({ message: 'Update failed' });
  }
};

// =======================
// DELETE EVENT (ADMIN)
// =======================
exports.deleteEvent = async (req, res) => {
  try {
    const deleted = await Event.findByIdAndDelete(req.params.id);

    if (!deleted) {
      return res.status(404).json({ message: 'Event not found' });
    }

    return res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('DELETE EVENT ERROR ❌', error);
    return res.status(400).json({ message: 'Delete failed' });
  }
};

// =======================
// BOOK SEATS (LOGGED IN USER)
// =======================
exports.bookSeats = async (req, res) => {
  try {
    const seats = Number(req.body.seats);

    if (!seats || seats < 1) {
      return res.status(400).json({ message: 'Seats must be at least 1' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const booked = event.bookedSeats ?? 0;
    const remaining = event.totalSeats - booked;

    if (seats > remaining) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    event.bookedSeats = booked + seats;
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
