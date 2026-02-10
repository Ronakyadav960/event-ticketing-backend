const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    totalEvents: 0,
    totalBookings: 0,
    message: 'Dashboard API working'
  });
});

module.exports = router;
