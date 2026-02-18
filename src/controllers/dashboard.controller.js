const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const User = require('../models/User');

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Monthly key like 2026-02
function monthKeyExpr(dateField) {
  return {
    $dateToString: { format: '%Y-%m', date: dateField },
  };
}

/**
 * CREATOR DASHBOARD (advanced)
 * - totals
 * - per-event booking stats + revenue
 * - top event
 * - monthly booking trend
 */
exports.getCreatorDashboard = async (req, res) => {
  try {
    const creatorId = req.user?._id;
    if (!creatorId) return res.status(401).json({ message: 'Unauthorized' });

    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    // 1) Find creator events
    const myEvents = await Event.find({ createdBy: creatorId }).select('_id title price totalSeats bookedSeats date');
    const eventIds = myEvents.map((e) => e._id);

    // If no events, return empty advanced structure
    if (eventIds.length === 0) {
      return res.json({
        totals: {
          events: 0,
          bookings: 0,
          seatsBooked: 0,
          revenue: 0,
        },
        topEvent: null,
        perEvent: [],
        monthlyTrend: [],
      });
    }

    // 2) Aggregation: per-event booking stats
    const bookingMatch = {
      event: { $in: eventIds },
    };
    if (from || to) {
      bookingMatch.createdAt = {};
      if (from) bookingMatch.createdAt.$gte = from;
      if (to) bookingMatch.createdAt.$lte = to;
    }

    const perEventAgg = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $group: {
          _id: '$event',
          bookings: { $sum: 1 },
          seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
        },
      },
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $unwind: '$event' },
      {
        $project: {
          _id: 0,
          eventId: '$_id',
          title: '$event.title',
          price: { $ifNull: ['$event.price', 0] },
          totalSeats: { $ifNull: ['$event.totalSeats', 0] },
          bookedSeats: { $ifNull: ['$event.bookedSeats', 0] },
          bookings: 1,
          seatsBooked: 1,
          revenue: { $multiply: ['$seatsBooked', { $ifNull: ['$event.price', 0] }] },
        },
      },
      { $sort: { revenue: -1, bookings: -1 } },
    ]);

    // If no bookings in range, still show events with 0 stats
    const perEventMap = new Map(perEventAgg.map((x) => [String(x.eventId), x]));
    const perEvent = myEvents.map((ev) => {
      const found = perEventMap.get(String(ev._id));
      return (
        found || {
          eventId: ev._id,
          title: ev.title,
          price: Number(ev.price || 0),
          totalSeats: Number(ev.totalSeats || 0),
          bookedSeats: Number(ev.bookedSeats || 0),
          bookings: 0,
          seatsBooked: 0,
          revenue: 0,
        }
      );
    }).sort((a,b)=> (b.revenue - a.revenue) || (b.bookings - a.bookings));

    // 3) totals
    const totals = perEvent.reduce(
      (acc, e) => {
        acc.events += 0; // set below
        acc.bookings += Number(e.bookings || 0);
        acc.seatsBooked += Number(e.seatsBooked || 0);
        acc.revenue += Number(e.revenue || 0);
        return acc;
      },
      { events: myEvents.length, bookings: 0, seatsBooked: 0, revenue: 0 }
    );

    // 4) top event
    const topEvent = perEvent.length ? perEvent[0] : null;

    // 5) monthly trend (bookings + seats + revenue)
    const monthlyTrend = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $unwind: '$event' },
      // ensure only my events (extra safety)
      { $match: { 'event.createdBy': new mongoose.Types.ObjectId(creatorId) } },
      {
        $group: {
          _id: monthKeyExpr('$createdAt'),
          bookings: { $sum: 1 },
          seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
          revenue: {
            $sum: {
              $multiply: [{ $ifNull: ['$seats', 1] }, { $ifNull: ['$event.price', 0] }],
            },
          },
        },
      },
      { $project: { _id: 0, month: '$_id', bookings: 1, seatsBooked: 1, revenue: 1 } },
      { $sort: { month: 1 } },
    ]);

    return res.json({
      totals,
      topEvent,
      perEvent,
      monthlyTrend,
    });
  } catch (err) {
    console.error('getCreatorDashboard error:', err);
    return res.status(500).json({ message: 'Creator dashboard failed' });
  }
};

/**
 * SUPERADMIN DASHBOARD (advanced)
 * - totals users/creators/events/bookings/revenue
 * - monthly trends
 * - top events across platform
 * - top creators (events + bookings + revenue)
 */
exports.getSuperadminDashboard = async (req, res) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    const bookingMatch = {};
    if (from || to) {
      bookingMatch.createdAt = {};
      if (from) bookingMatch.createdAt.$gte = from;
      if (to) bookingMatch.createdAt.$lte = to;
    }

    const [totalUsers, totalCreators, totalEvents, totalBookings] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'creator' }),
      Event.countDocuments({}),
      Booking.countDocuments(bookingMatch),
    ]);

    // Revenue total (range-aware)
    const revenueAgg = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $unwind: '$event' },
      {
        $group: {
          _id: null,
          revenue: {
            $sum: {
              $multiply: [{ $ifNull: ['$seats', 1] }, { $ifNull: ['$event.price', 0] }],
            },
          },
          seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
        },
      },
      { $project: { _id: 0, revenue: 1, seatsBooked: 1 } },
    ]);

    const totals = {
      users: totalUsers,
      creators: totalCreators,
      events: totalEvents,
      bookings: totalBookings,
      seatsBooked: revenueAgg?.[0]?.seatsBooked || 0,
      revenue: revenueAgg?.[0]?.revenue || 0,
    };

    // Monthly trend platform-wide
    const monthlyTrend = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $lookup: {
          from: 'events',
          localField: 'event',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $unwind: '$event' },
      {
        $group: {
          _id: monthKeyExpr('$createdAt'),
          bookings: { $sum: 1 },
          seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
          revenue: {
            $sum: {
              $multiply: [{ $ifNull: ['$seats', 1] }, { $ifNull: ['$event.price', 0] }],
            },
          },
        },
      },
      { $project: { _id: 0, month: '$_id', bookings: 1, seatsBooked: 1, revenue: 1 } },
      { $sort: { month: 1 } },
    ]);

    // Top Events (by revenue, then bookings)
    const topEvents = await Booking.aggregate([
      { $match: bookingMatch },
      {
        $group: {
          _id: '$event',
          bookings: { $sum: 1 },
          seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
        },
      },
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: '_id',
          as: 'event',
        },
      },
      { $unwind: '$event' },
      {
        $project: {
          _id: 0,
          eventId: '$_id',
          title: '$event.title',
          createdBy: '$event.createdBy',
          price: { $ifNull: ['$event.price', 0] },
          bookings: 1,
          seatsBooked: 1,
          revenue: { $multiply: ['$seatsBooked', { $ifNull: ['$event.price', 0] }] },
        },
      },
      { $sort: { revenue: -1, bookings: -1 } },
      { $limit: 10 },
      // attach creator info
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: '_id',
          as: 'creator',
        },
      },
      { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          eventId: 1,
          title: 1,
          bookings: 1,
          seatsBooked: 1,
          revenue: 1,
          creator: {
            id: '$creator._id',
            name: '$creator.name',
            email: '$creator.email',
          },
        },
      },
    ]);

    // Top Creators (events + bookings + revenue)
    const topCreators = await Event.aggregate([
      {
        $match: {
          createdBy: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$createdBy',
          eventsCreated: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'creator',
        },
      },
      { $unwind: '$creator' },
      { $match: { 'creator.role': 'creator' } },
      // for each creator, compute bookings & revenue via lookup pipeline
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: 'createdBy',
          as: 'events',
        },
      },
      {
        $lookup: {
          from: 'bookings',
          let: { eventIds: '$events._id' },
          pipeline: [
            { $match: { $expr: { $in: ['$event', '$$eventIds'] } } },
            ...(from || to
              ? [
                  {
                    $match: {
                      createdAt: {
                        ...(from ? { $gte: from } : {}),
                        ...(to ? { $lte: to } : {}),
                      },
                    },
                  },
                ]
              : []),
            {
              $group: {
                _id: null,
                bookings: { $sum: 1 },
                seatsBooked: { $sum: { $ifNull: ['$seats', 1] } },
              },
            },
          ],
          as: 'bookingStats',
        },
      },
      {
        $addFields: {
          bookings: { $ifNull: [{ $arrayElemAt: ['$bookingStats.bookings', 0] }, 0] },
          seatsBooked: { $ifNull: [{ $arrayElemAt: ['$bookingStats.seatsBooked', 0] }, 0] },
        },
      },
      // revenue needs prices => compute from bookings joined to events
      {
        $lookup: {
          from: 'bookings',
          let: { eventIds: '$events._id' },
          pipeline: [
            { $match: { $expr: { $in: ['$event', '$$eventIds'] } } },
            ...(from || to
              ? [
                  {
                    $match: {
                      createdAt: {
                        ...(from ? { $gte: from } : {}),
                        ...(to ? { $lte: to } : {}),
                      },
                    },
                  },
                ]
              : []),
            {
              $lookup: {
                from: 'events',
                localField: 'event',
                foreignField: '_id',
                as: 'event',
              },
            },
            { $unwind: '$event' },
            {
              $group: {
                _id: null,
                revenue: {
                  $sum: {
                    $multiply: [{ $ifNull: ['$seats', 1] }, { $ifNull: ['$event.price', 0] }],
                  },
                },
              },
            },
          ],
          as: 'revStats',
        },
      },
      {
        $addFields: {
          revenue: { $ifNull: [{ $arrayElemAt: ['$revStats.revenue', 0] }, 0] },
        },
      },
      {
        $project: {
          _id: 0,
          creator: {
            id: '$creator._id',
            name: '$creator.name',
            email: '$creator.email',
          },
          eventsCreated: 1,
          bookings: 1,
          seatsBooked: 1,
          revenue: 1,
        },
      },
      { $sort: { revenue: -1, bookings: -1, eventsCreated: -1 } },
      { $limit: 10 },
    ]);

    return res.json({
      totals,
      monthlyTrend,
      topEvents,
      topCreators,
    });
  } catch (err) {
    console.error('getSuperadminDashboard error:', err);
    return res.status(500).json({ message: 'Superadmin dashboard failed' });
  }
};
