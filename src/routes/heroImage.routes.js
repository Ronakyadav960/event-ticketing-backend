const express = require('express');
const router = express.Router();

const heroCtrl = require('../controllers/heroImage.controller');

// Public: used on Home/Events page carousel
router.get('/', heroCtrl.listPublic);

module.exports = router;

