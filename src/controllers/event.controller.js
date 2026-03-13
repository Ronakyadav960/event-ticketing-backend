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

function escapeRegex(input) {
  return String(input || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DEFAULT_CATEGORIES = [
  'Conference',
  'Workshop',
  'Seminar',
  'Concert',
  'Webinar',
  'Movie',
  'Comedy',
  'Sports',
];

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

    const {
      title,
      description,
      date,
      venue,
      price,
      totalSeats,
      category,
      locationType,
      registrationTemplate,
      designTemplate,
      imagePreset,
      designConfig,
      customFields,
    } = req.body;

    if (!title || !date || !venue || price == null || totalSeats == null || !category) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    let imageFileId = null;

    if (req.file) {
      imageFileId = await uploadBufferToGridFS(req.file);
    }

    const parsedCustomFields = parseCustomFields(customFields);
    const parsedDesignConfig = parseJsonObject(designConfig);

    const event = await Event.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      date: new Date(date),
      venue: String(venue).trim(),
      price: Number(price),
      totalSeats: Number(totalSeats),
      category: String(category).trim(),
      locationType: locationType ? String(locationType).trim() : '',
      bookedSeats: 0,
      createdBy: req.user.id, // ownership
      imageFileId,
      imageUrl: imageFileId ? buildImagePath(undefined) : '',
      registrationTemplate: registrationTemplate || 'standard',
      designTemplate: designTemplate || 'clean-hero',
      imagePreset: imagePreset || 'preset-a',
      designConfig: parsedDesignConfig,
      customFields: parsedCustomFields,
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
    const rawCategory = String(req.query.category || '').trim();
    const category =
      rawCategory && rawCategory.toLowerCase() !== 'all' ? rawCategory : '';

    const filter = {};
    if (category) {
      filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
    }

    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);
    const paged = 'page' in req.query || 'limit' in req.query;
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
    const skip = (page - 1) * limit;

    if (!paged) {
      const events = await Event.find(filter).sort({ date: 1 });
      return res.json(events);
    }

    const [total, events] = await Promise.all([
      Event.countDocuments(filter),
      Event.find(filter).sort({ date: 1 }).skip(skip).limit(limit)
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({ data: events, page, limit, total, totalPages });
  } catch (error) {
    console.error('GET ALL EVENTS ERROR ❌', error);
    return res.status(500).json({ message: 'Failed to fetch events' });
  }
};

// =======================
// GET CATEGORIES (PUBLIC)
// =======================
exports.getCategories = async (req, res) => {
  try {
    const distinct = await Event.distinct('category');
    const merged = Array.from(
      new Set(
        [...DEFAULT_CATEGORIES, ...(distinct || [])]
          .map((c) => String(c || '').trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return res.json({ categories: merged });
  } catch (error) {
    console.error('GET CATEGORIES ERROR ❌', error);
    return res.status(500).json({ message: 'Failed to fetch categories' });
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
    if (req.body.category != null) event.category = String(req.body.category).trim();
    if (req.body.locationType != null) event.locationType = String(req.body.locationType).trim();
    if (req.body.registrationTemplate != null) event.registrationTemplate = String(req.body.registrationTemplate);
    if (req.body.designTemplate != null) event.designTemplate = String(req.body.designTemplate);
    if (req.body.imagePreset != null) event.imagePreset = String(req.body.imagePreset);
    if (req.body.designConfig != null) event.designConfig = parseJsonObject(req.body.designConfig);
    if (req.body.customFields != null) event.customFields = parseCustomFields(req.body.customFields);
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
function parseCustomFields(input) {
  if (!input) return [];
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((f) => ({
        label: String(f?.label || '').trim(),
        type: String(f?.type || 'text'),
        required: Boolean(f?.required),
        options: Array.isArray(f?.options) ? f.options.map((o) => String(o)) : [],
      }))
      .filter((f) => f.label);
  } catch {
    return [];
  }
}

function parseJsonObject(input) {
  if (!input) return {};
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}




