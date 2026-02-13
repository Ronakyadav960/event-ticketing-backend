// routes/event.routes.js ✅ UPDATED (GridFS + Disk uploads compatible + safer path)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const path = require('path');
const { GridFSBucket } = require('mongodb');

const { protect, admin } = require('../middlewares/auth.middleware');
const eventController = require('../controllers/event.controller');
const upload = require('../middlewares/eventUploadGridfs.middleware'); // same as your file

const Event = require('../models/Event');

// =======================
// GridFS Bucket (eventImages)
// =======================
let bucket;
function getBucket() {
  if (!bucket) {
    if (!mongoose.connection?.db) throw new Error('MongoDB not connected');
    bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'eventImages' });
  }
  return bucket;
}

// =======================
// PUBLIC ROUTES
// =======================
router.get('/', eventController.getAllEvents);
router.get('/:id', eventController.getEventById);

// ✅ Public: stream event image (GridFS if available, else local uploads fallback)
router.get('/:id/image', async (req, res) => {
  try {
    const ev = await Event.findById(req.params.id);
    if (!ev) return res.status(404).send('Event not found');

    // 1) ✅ If GridFS file exists
    if (ev.imageFileId) {
      const fileId = new mongoose.Types.ObjectId(ev.imageFileId);
      const gfsBucket = getBucket();

      // Try to set correct content-type (optional but helps)
      try {
        const files = await gfsBucket.find({ _id: fileId }).toArray();
        const file = files?.[0];
        if (file?.contentType) res.set('Content-Type', file.contentType);
        // cache can be enabled if you want:
        // res.set('Cache-Control', 'public, max-age=3600');
      } catch (e) {
        // ignore
      }

      const stream = gfsBucket.openDownloadStream(fileId);
      stream.on('error', () => res.status(404).send('Image not found'));
      return stream.pipe(res);
    }

    // 2) ✅ Fallback: if disk imageUrl exists (/uploads/...)
    if (ev.imageUrl && typeof ev.imageUrl === 'string' && ev.imageUrl.startsWith('/uploads/')) {
      // IMPORTANT: path.join ignores previous segments if the next arg is absolute (starts with '/')
      const rel = ev.imageUrl.replace(/^\//, ''); // "uploads/..."
      const absPath = path.join(__dirname, '..', rel);

      return res.sendFile(absPath, (err) => {
        if (err) return res.status(404).send('Image not found');
      });
    }

    // 3) Nothing found
    return res.status(404).send('No image');
  } catch (e) {
    return res.status(400).send('Invalid request');
  }
});

// =======================
// ADMIN ROUTES
// =======================
router.post('/', protect, admin, upload.single('image'), eventController.createEvent);
router.put('/:id', protect, admin, upload.single('image'), eventController.updateEvent);
router.delete('/:id', protect, admin, eventController.deleteEvent);

// =======================
// BOOK SEATS (USER LOGGED IN)
// =======================
router.post('/:id/book', protect, eventController.bookSeats);

module.exports = router;
