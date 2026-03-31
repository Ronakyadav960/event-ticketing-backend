const fs = require('fs');
const path = require('path');
const HeroImage = require('../models/HeroImage');

const HERO_LIMIT = 6;

function toClient(img) {
  return {
    _id: img._id,
    url: img.path,
    createdAt: img.createdAt,
  };
}

exports.listPublic = async (req, res) => {
  try {
    const list = await HeroImage.find().sort({ createdAt: -1 }).limit(HERO_LIMIT);
    // Oldest-first for stable carousel order
    const ordered = [...list].reverse().map(toClient);
    res.json({ images: ordered });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch hero images' });
  }
};

exports.listAdmin = async (req, res) => {
  return exports.listPublic(req, res);
};

exports.upload = async (req, res) => {
  try {
    const count = await HeroImage.countDocuments();
    if (count >= HERO_LIMIT) {
      return res
        .status(400)
        .json({ message: `Max ${HERO_LIMIT} hero images allowed. Delete one first.` });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Image file missing' });
    }

    const filename = req.file.filename;
    const publicPath = `/uploads/hero/${filename}`;

    const doc = await HeroImage.create({
      filename,
      path: publicPath,
    });

    res.status(201).json({ image: toClient(doc) });
  } catch (err) {
    res.status(500).json({ message: err?.message || 'Failed to upload hero image' });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const img = await HeroImage.findById(id);
    if (!img) return res.status(404).json({ message: 'Hero image not found' });

    const filePath = path.join(__dirname, '..', img.path.replace(/^\/+/, ''));
    await img.deleteOne();

    fs.unlink(filePath, () => {
      // ignore unlink errors (file might already be missing)
    });

    res.json({ message: 'Hero image deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete hero image' });
  }
};

