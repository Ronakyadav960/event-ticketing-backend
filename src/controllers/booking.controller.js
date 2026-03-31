const Booking = require('../models/Booking');
const Event = require('../models/Event');

function parseShowAt(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getEventTimeZone() {
  return (process.env.EVENT_TIMEZONE || 'Asia/Kolkata').trim() || 'Asia/Kolkata';
}

function yyyyMmDdInTz(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function hhmmInTz(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.hour}:${map.minute}`;
}

function isShowTimeAllowed(eventDoc, showAt) {
  if (!eventDoc || !showAt) return true;

  const start = eventDoc.startDate ? new Date(eventDoc.startDate) : null;
  const end = eventDoc.endDate ? new Date(eventDoc.endDate) : null;
  const times = Array.isArray(eventDoc.showTimes) ? eventDoc.showTimes : [];
  const tz = getEventTimeZone();

  if (start && !Number.isNaN(start.getTime())) {
    const showDateOnly = new Date(`${yyyyMmDdInTz(showAt, tz)}T00:00:00.000Z`);

    if (showDateOnly.getTime() < start.getTime()) return false;

    if (end && !Number.isNaN(end.getTime()) && showDateOnly.getTime() > end.getTime()) {
      return false;
    }
  }

  if (times.length) {
    const hhmm = hhmmInTz(showAt, tz);
    if (!times.includes(hhmm)) return false;
  }

  return true;
}

// GET BOOKING BY TICKET ID
exports.getByTicketId = async (req, res) => {
  try {
    const { ticketId } = req.params;
    if (!ticketId) return res.status(400).json({ message: 'ticketId missing' });

    const booking = await Booking.findOne({ ticketId }).populate('event');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    res.json(booking);
  } catch (err) {
    console.error('getByTicketId error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// CREATE BOOKING 
exports.createBooking = async (req, res) => {
  try {
    const { eventId, name, email, seats, registrationTemplate, registrationData, showAt } = req.body;

    // ✅ auth required: user must exist from middleware
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!eventId) return res.status(400).json({ message: 'eventId missing' });

    const seatCount = Math.max(1, Number(seats || 1));

    // Validate show selection (optional but recommended)
    const showAtDate = parseShowAt(showAt);

    const eventDoc = await Event.findById(eventId).select('date startDate endDate showTimes totalSeats bookedSeats');
    if (!eventDoc) return res.status(404).json({ message: 'Event not found' });

    const effectiveShowAt = showAtDate || (eventDoc.date ? new Date(eventDoc.date) : null);
    if (!effectiveShowAt || Number.isNaN(effectiveShowAt.getTime())) {
      return res.status(400).json({ message: 'Invalid show date/time' });
    }

    if (effectiveShowAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'Cannot book past events' });
    }

    if (!isShowTimeAllowed(eventDoc, effectiveShowAt)) {
      return res.status(400).json({ message: 'Selected show date/time not available' });
    }

    // ✅ ticketId generate
    const ticketId = `TKT-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    // ✅ 1) atomic increment with availability check
    const updatedEvent = await Event.findOneAndUpdate(
      {
        _id: eventId,
        $expr: {
          $lte: [{ $add: ['$bookedSeats', seatCount] }, '$totalSeats'],
        },
      },
      { $inc: { bookedSeats: seatCount } },
      { new: true }
    );

    if (!updatedEvent) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    // ✅ 2) create booking
    const booking = await Booking.create({
      user: userId,
      event: eventId,
      seats: seatCount,
      name: name || '',
      email: email || '',
      registrationTemplate: registrationTemplate || 'standard',
      registrationData: registrationData || {},
      ticketId,
      showAt: effectiveShowAt,
    });

    res.status(201).json({
      message: 'Booking created',
      ticketId: booking.ticketId,
      booking,
      event: updatedEvent, // frontend can refresh UI from this
    });
  } catch (err) {
    console.error('createBooking error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
