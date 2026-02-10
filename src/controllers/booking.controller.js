const Booking = require('../models/Booking');
const Event = require('../models/Event');

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
    const { eventId, name, email, seats } = req.body;

    // ✅ auth required: user must exist from middleware
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!eventId) return res.status(400).json({ message: 'eventId missing' });

    const seatCount = Math.max(1, Number(seats || 1));

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
      ticketId,
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
