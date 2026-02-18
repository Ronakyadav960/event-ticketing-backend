const express = require('express');
const router = express.Router();
const { protect, authorizeRoles } = require('../middlewares/auth.middleware');

// TEMP TEST ROUTES

router.get('/creator', protect, authorizeRoles('creator', 'superadmin'), (req, res) => {
  res.json({
    message: 'Creator dashboard working',
    user: req.user
  });
});

router.get('/superadmin', protect, authorizeRoles('superadmin'), (req, res) => {
  res.json({
    message: 'Superadmin dashboard working',
    user: req.user
  });
});

module.exports = router;
