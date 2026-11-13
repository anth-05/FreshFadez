import { Router } from 'express';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Block from '../models/Block.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { barberAuth } from '../middleware/barberAuth.js';
import { RESCHEDULE_DAYS_AHEAD, isClosedOn, nowInShop, addDays } from '../config/businessHours.js';
import { createBooking, parseCustomer } from '../lib/newBooking.js';
import {
  assertNoOverlap,
  assertSlotOpen,
  assertValidLength,
  blocksOverlapping,
  hasEnded,
  hasStarted,
  isValidDate,
  isValidStamp,
  lengthOf,
  nowStamp,
  occupiedRange,
  overlaps,
  placement,
  slotStatuses,
} from '../lib/slots.js';

const router = Router();
const VIEWS = ['upcoming', 'past', 'cancelled'];
const MAX_BLOCK_DAYS = 366;
const PAGE_SIZE = 10;

router.use(barberAuth);

// `allowStarted`: an appointment in progress can still be edited (e.g. it finished early),
// just not moved or cancelled.
async function findConfirmed(id, { allowStarted = false } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Booking not found');
  const booking = await Booking.findById(id).lean();
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status === 'cancelled') throw new ApiError(409, 'This booking is already cancelled');
  if (allowStarted ? hasEnded(booking) : hasStarted(booking.date, booking.time)) {
    throw new ApiError(400, allowStarted ? 'This appointment is already over' : 'This appointment has already started or passed');
  }
  return booking;
}

// Pages hold at most PAGE_SIZE appointments, but a day is never split across two pages.
async function paginateByDay(filter, sort, page) {
  const dates = await Booking.find(filter).sort(sort).select('date').lean();
  const pages = [];
  let current = null;
  let i = 0;
  while (i < dates.length) {
    let j = i;
    while (j < dates.length && dates[j].date === dates[i].date) j++;
    const dayCount = j - i;
    if (!current || (current.limit > 0 && current.limit + dayCount > PAGE_SIZE)) {
      current = { skip: i, limit: 0 };
      pages.push(current);
    }
    current.limit += dayCount;
    i = j;
  }
  const total = dates.length;
  const pageCount = Math.max(pages.length, 1);
  // Past the end (e.g. the last item on the last page was just cancelled): show the last page.
  const p = Math.min(page, pageCount);
  const items = pages.length
    ? await Booking.find(filter).sort(sort).skip(pages[p - 1].skip).limit(pages[p - 1].limit).lean()
    : [];
  return { items, page: p, pages: pageCount, total };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches name (first, last or full), email, or phone. Phone digits match regardless of spaces or dashes.
function searchFilter(q) {
  const text = new RegExp(escapeRegex(q), 'i');
  const or = [
    { firstName: text },
    { lastName: text },
    { email: text },
    { phone: text },
    { $expr: { $regexMatch: { input: { $concat: ['$firstName', ' ', '$lastName'] }, regex: escapeRegex(q), options: 'i' } } },
  ];
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d\s()+-]+$/.test(q)) {
    or.push({ phone: new RegExp(digits.split('').join('\\D*')) });
  }
  return { $or: or };
}

router.get(
  '/bookings',
  asyncHandler(async (req, res) => {
    const view = req.query.view ?? 'upcoming';
    if (!VIEWS.includes(view)) throw new ApiError(400, `view must be one of: ${VIEWS.join(', ')}`);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100) throw new ApiError(400, 'q can be at most 100 characters');
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'page must be a positive whole number');

    // An appointment counts as past once it has ended.
    const now = nowInShop();

    let filter;
    let sort;
    if (view === 'cancelled') {
      filter = { status: 'cancelled' };
      sort = { date: -1, time: -1, _id: -1 };
    } else if (view === 'upcoming') {
      filter = { status: 'confirmed', $or: [{ date: { $gt: now.date } }, { date: now.date, end: { $gt: now.time } }] };
      sort = { date: 1, time: 1, _id: 1 };
    } else {
      filter = { status: 'confirmed', $or: [{ date: { $lt: now.date } }, { date: now.date, end: { $lte: now.time } }] };
      sort = { date: -1, time: -1, _id: -1 };
    }
    if (q) filter = { $and: [filter, searchFilter(q)] };

    res.json(await paginateByDay(filter, sort, page));
  })
);

// The barber plans in an appointment (phone call, walk-in). Same clash rules as online bookings,
// but email is optional and it can be planned as far ahead as a reschedule.
router.post(
  '/bookings',
  asyncHandler(async (req, res) => {
    const { date, time, serviceSlugs, length } = req.body ?? {};
    const booking = await createBooking({
      customer: parseCustomer(req.body, { emailRequired: false }),
      serviceSlugs,
      date,
      time,
      length,
      byBarber: true,
      maxDaysAhead: RESCHEDULE_DAYS_AHEAD,
      extra: { source: 'barber', saveInfo: false },
    });
    res.status(201).json(booking);
  })
);

// Edit an appointment's length and customer details. Fields left out keep their current value.
// Shortening frees the time after it; lengthening is refused if it runs into another appointment
// or a blocked period.
router.patch(
  '/bookings/:id',
  asyncHandler(async (req, res) => {
    const booking = await findConfirmed(req.params.id, { allowStarted: true });
    const body = req.body ?? {};
    const current = { firstName: booking.firstName, lastName: booking.lastName, email: booking.email, phone: booking.phone, notes: booking.notes };
    const customer = parseCustomer({ ...current, ...body }, { emailRequired: false });
    const length = body.length === undefined ? lengthOf(booking) : body.length;
    assertValidLength(length);

    const place = placement(booking.date, booking.time, length);
    if (length > lengthOf(booking)) {
      const blocks = await blocksOverlapping(occupiedRange(booking.date, booking.time, length));
      if (blocks.length) throw new ApiError(409, 'That would run into a blocked period');
      await assertNoOverlap(booking.date, booking.time, length, booking._id);
    }
    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: 'confirmed', date: booking.date, time: booking.time },
        { ...customer, length: place.length, end: place.end, slots: place.slots },
        { new: true, runValidators: true }
      );
      if (!updated) throw new ApiError(409, 'This booking changed in the meantime, please refresh');
      res.json(updated);
    } catch (err) {
      if (err.code === 11000) throw new ApiError(409, 'That would run into another appointment');
      throw err;
    }
  })
);

router.post(
  '/bookings/:id/cancel',
  asyncHandler(async (req, res) => {
    const booking = await findConfirmed(req.params.id);
    // Conditional update so two clicks (or two devices) can't both "win".
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'confirmed' },
      { status: 'cancelled', cancelledAt: new Date() },
      { new: true }
    );
    if (!updated) throw new ApiError(409, 'This booking is already cancelled');
    res.json(updated);
  })
);

router.post(
  '/bookings/:id/reschedule',
  asyncHandler(async (req, res) => {
    const { date, time } = req.body ?? {};
    const booking = await findConfirmed(req.params.id);
    if (booking.date === date && booking.time === time) {
      throw new ApiError(400, 'Pick a different date or time');
    }
    const length = lengthOf(booking);
    await assertSlotOpen(date, time, { maxDaysAhead: RESCHEDULE_DAYS_AHEAD, length, quarters: true, excludeId: booking._id });

    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: 'confirmed', date: booking.date, time: booking.time },
        { ...placement(date, time, length), rescheduledFrom: { date: booking.date, time: booking.time } },
        { new: true }
      );
      if (!updated) throw new ApiError(409, 'This booking changed in the meantime, please refresh');
      res.json(updated);
    } catch (err) {
      if (err.code === 11000) throw new ApiError(409, 'That time is already taken by another booking');
      throw err;
    }
  })
);

router.get(
  '/slots',
  asyncHandler(async (req, res) => {
    const { date, booking: bookingId, duration } = req.query;
    if (!isValidDate(date)) throw new ApiError(400, 'Query param "date" must be formatted as YYYY-MM-DD');
    // When picking a new time for a booking, judge slots by its duration and ignore its current spot.
    // When planning a new appointment, judge them by the length the barber chose.
    // The barber can start appointments on any quarter hour.
    let options = {};
    if (bookingId !== undefined && duration !== undefined) {
      throw new ApiError(400, 'Use either "booking" or "duration", not both');
    }
    if (duration !== undefined) {
      const minutes = Number(duration);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) {
        throw new ApiError(400, 'duration must be a whole number of minutes between 1 and 600');
      }
      options = { length: minutes };
    } else if (bookingId !== undefined) {
      if (!mongoose.isValidObjectId(bookingId)) throw new ApiError(404, 'Booking not found');
      const booking = await Booking.findById(bookingId).select('length totalDuration').lean();
      if (!booking) throw new ApiError(404, 'Booking not found');
      options = { length: lengthOf(booking), excludeId: booking._id };
    }
    if (isClosedOn(date)) return res.json({ date, closed: true, slots: [] });
    res.json({ date, closed: false, slots: await slotStatuses(date, { ...options, quarters: true }) });
  })
);

router.get(
  '/blocks',
  asyncHandler(async (req, res) => {
    const blocks = await Block.find({ end: { $gt: nowStamp() } }).sort({ start: 1 }).lean();
    res.json(blocks);
  })
);

router.post(
  '/blocks',
  asyncHandler(async (req, res) => {
    const { start, end, reason = '' } = req.body ?? {};
    if (!isValidStamp(start) || !isValidStamp(end)) {
      throw new ApiError(400, 'start and end must be formatted as YYYY-MM-DDTHH:mm');
    }
    if (end <= start) throw new ApiError(400, 'end must be after start');
    if (end <= nowStamp()) throw new ApiError(400, 'This period is already over');
    if (end.slice(0, 10) > addDays(start.slice(0, 10), MAX_BLOCK_DAYS)) {
      throw new ApiError(400, `A period can be at most ${MAX_BLOCK_DAYS} days long`);
    }
    if (typeof reason !== 'string' || reason.length > 200) {
      throw new ApiError(400, 'reason must be text of at most 200 characters');
    }

    // Refuse to hide existing appointments: the barber has to move or cancel them first.
    const range = { start, end };
    const candidates = await Booking.find({
      status: 'confirmed',
      date: { $gte: start.slice(0, 10), $lte: end.slice(0, 10) },
    })
      .sort({ date: 1, time: 1 })
      .lean();
    // Appointments that already started can't be moved anyway, so they don't stand in the way.
    const conflicts = candidates.filter(
      (b) => overlaps(range, occupiedRange(b.date, b.time, lengthOf(b))) && !hasStarted(b.date, b.time)
    );
    if (conflicts.length) {
      throw new ApiError(
        409,
        'There are appointments in this period. Reschedule or cancel them first.',
        conflicts.map((b) => ({ _id: b._id, date: b.date, time: b.time, firstName: b.firstName, lastName: b.lastName }))
      );
    }

    const block = await Block.create({ start, end, reason: reason.trim() });
    res.status(201).json(block);
  })
);

router.delete(
  '/blocks/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Block not found');
    const block = await Block.findByIdAndDelete(req.params.id);
    if (!block) throw new ApiError(404, 'Block not found');
    res.status(204).end();
  })
);

export default router;
