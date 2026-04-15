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

function normalizeMovieId(input) {
  return String(input || '').trim();
}

function isValidObjectId(value) {
  if (!value) return false;
  return mongoose.Types.ObjectId.isValid(String(value));
}

function sanitizeEventDocumentForSave(event) {
  if (!event) return;

  if (event.imageFileId && !isValidObjectId(event.imageFileId)) {
    event.imageFileId = null;
  }

  if (!event.imageUrl) {
    event.imageUrl = '';
  }

  if (!Array.isArray(event.showTimes)) {
    event.showTimes = [];
  }
}

function getReadableSaveError(error) {
  if (!error) return 'Update failed';

  if (error.name === 'ValidationError' && error.errors) {
    const firstError = Object.values(error.errors)[0];
    return firstError?.message || error.message || 'Validation failed';
  }

  if (error.name === 'CastError') {
    const field = error.path || 'field';
    return `Invalid value for ${field}.`;
  }

  return error.message || 'Update failed';
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

function parseDateOnly(input) {
  const s = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseShowTimes(input) {
  if (!input) return [];

  let raw = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = trimmed.split(',').map((t) => t.trim());
    }
  }

  const list = Array.isArray(raw) ? raw : [raw];

  const seen = new Set();
  const out = [];

  for (const item of list) {
    const t = String(item || '').trim();
    if (!t) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }

  return out;
}

function toHHmmFromDateUTC(d) {
  if (!d) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function combineUtcDateAndTime(dateOnly, hhmm) {
  if (!dateOnly || !hhmm) return null;
  const [hRaw, mRaw] = String(hhmm).split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(
    Date.UTC(
      dateOnly.getUTCFullYear(),
      dateOnly.getUTCMonth(),
      dateOnly.getUTCDate(),
      h,
      m,
      0,
      0
    )
  );
  return Number.isNaN(d.getTime()) ? null : d;
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

    const {
      title,
      description,
      date,
      startDate,
      endDate,
      showTimes,
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

    if (!title || !venue || price == null || totalSeats == null || !category) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const parsedStartDate = parseDateOnly(startDate);
    const parsedEndDate = parseDateOnly(endDate);
    const parsedShowTimes = parseShowTimes(showTimes);

    let legacyDate = date ? new Date(date) : null;
    if (legacyDate && Number.isNaN(legacyDate.getTime())) legacyDate = null;

    // Backward compatibility: allow old payload with only `date`
    const hasSchedule = Boolean(parsedStartDate && parsedEndDate);

    if (hasSchedule) {
      if (parsedEndDate.getTime() < parsedStartDate.getTime()) {
        return res.status(400).json({ message: 'endDate must be after startDate' });
      }

      if (!legacyDate && parsedShowTimes.length) {
        legacyDate = combineUtcDateAndTime(parsedStartDate, parsedShowTimes[0]);
      }
    }

    if (!legacyDate) {
      return res.status(400).json({ message: 'date missing/invalid' });
    }

    const scheduleStart = hasSchedule ? parsedStartDate : parseDateOnly(legacyDate.toISOString().slice(0, 10));
    const scheduleEnd = hasSchedule ? parsedEndDate : scheduleStart;
    const times = parsedShowTimes.length ? parsedShowTimes : [toHHmmFromDateUTC(legacyDate)];

    let imageFileId = null;

    if (req.file) {
      imageFileId = await uploadBufferToGridFS(req.file);
    }

    const parsedCustomFields = parseCustomFields(customFields);
    const parsedDesignConfig = parseJsonObject(designConfig);

    const event = await Event.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : '',
      date: legacyDate,
      startDate: scheduleStart,
      endDate: scheduleEnd,
      showTimes: times,
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
    const rawQuery = String(req.query.q || req.query.query || '').trim();
    const rawSourceMovieId = normalizeMovieId(req.query.sourceMovieId);
    const rawSourceType = String(req.query.sourceType || '').trim();
    const category =
      rawCategory && rawCategory.toLowerCase() !== 'all' ? rawCategory : '';

    const filter = {};
    if (category) {
      filter.category = new RegExp(`^${escapeRegex(category)}$`, 'i');
    }
    if (rawSourceMovieId) {
      filter.sourceMovieId = rawSourceMovieId;
    }
    if (rawSourceType) {
      filter.sourceType = new RegExp(`^${escapeRegex(rawSourceType)}$`, 'i');
    }
    if (rawQuery) {
      const queryRegex = new RegExp(escapeRegex(rawQuery), 'i');
      filter.$or = [
        { title: queryRegex },
        { venue: queryRegex },
        { category: queryRegex },
        { description: queryRegex },
        { sourceMovieId: queryRegex },
      ];
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

exports.getMovieEventBySource = async (req, res) => {
  try {
    const sourceMovieId = normalizeMovieId(req.params.movieId || req.query.sourceMovieId);
    if (!sourceMovieId) {
      return res.status(400).json({ message: 'sourceMovieId is required' });
    }

    const event = await Event.findOne({ sourceMovieId }).sort({ updatedAt: -1, createdAt: -1 });
    if (!event) {
      return res.status(404).json({ message: 'Movie event not found' });
    }

    return res.json(event);
  } catch (error) {
    console.error('GET MOVIE EVENT BY SOURCE ERROR', error);
    return res.status(500).json({ message: 'Failed to fetch movie event' });
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

    const updates = {};

    if (req.body.title != null) updates.title = String(req.body.title).trim();
    if (req.body.description != null) updates.description = String(req.body.description).trim();

    // Schedule fields (optional)
    const parsedStartDate = parseDateOnly(req.body.startDate);
    const parsedEndDate = parseDateOnly(req.body.endDate);
    const parsedShowTimes = parseShowTimes(req.body.showTimes);

    if (parsedStartDate && parsedEndDate && parsedEndDate.getTime() < parsedStartDate.getTime()) {
      return res.status(400).json({ message: 'endDate must be after startDate' });
    }

    if (req.body.date != null) {
      const d = new Date(req.body.date);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid date' });
      updates.date = d;
    }

    if (parsedStartDate) updates.startDate = parsedStartDate;
    if (parsedEndDate) updates.endDate = parsedEndDate;
    if (parsedShowTimes.length) updates.showTimes = parsedShowTimes;

    const nextStartDate = parsedStartDate || event.startDate;
    const nextShowTimes = parsedShowTimes.length ? parsedShowTimes : event.showTimes;

    // If schedule is sent without `date`, keep legacy date aligned with startDate + first showTime (fallback)
    if (
      (parsedStartDate || parsedEndDate || parsedShowTimes.length) &&
      req.body.date == null &&
      nextStartDate &&
      Array.isArray(nextShowTimes) &&
      nextShowTimes.length
    ) {
      const combined = combineUtcDateAndTime(nextStartDate, nextShowTimes[0]);
      if (combined) updates.date = combined;
    }

    if (req.body.venue != null) updates.venue = String(req.body.venue).trim();
    if (req.body.price != null) updates.price = Number(req.body.price);
    if (req.body.totalSeats != null) updates.totalSeats = Number(req.body.totalSeats);
    if (req.body.category != null) updates.category = String(req.body.category).trim();
    if (req.body.locationType != null) updates.locationType = String(req.body.locationType).trim();
    if (req.body.registrationTemplate != null) updates.registrationTemplate = String(req.body.registrationTemplate);
    if (req.body.designTemplate != null) updates.designTemplate = String(req.body.designTemplate);
    if (req.body.imagePreset != null) updates.imagePreset = String(req.body.imagePreset);
    if (req.body.designConfig != null) updates.designConfig = parseJsonObject(req.body.designConfig);
    if (req.body.customFields != null) updates.customFields = parseCustomFields(req.body.customFields);
    if (req.file) {
      const newId = await uploadBufferToGridFS(req.file);
      updates.imageFileId = newId;
      updates.imageUrl = buildImagePath(event._id);
    }

    const updatedEvent = await Event.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
      }
    );

    sanitizeEventDocumentForSave(updatedEvent);
    return res.json(updatedEvent);

  } catch (error) {
    console.error('UPDATE EVENT ERROR ❌', error);
    return res.status(400).json({ message: getReadableSaveError(error) });
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




