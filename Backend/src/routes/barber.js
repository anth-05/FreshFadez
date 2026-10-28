import { Router } from 'express';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import Block from '../models/Block.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { barberAuth } from '../middleware/barberAuth.js';
import { RESCHEDULE_DAYS_AHEAD, SLOT_MINUTES, isClosedOn, nowInShop, addDays } from '../config/businessHours.js';
import {
  assertSlotOpen,
  coveredSlots,
  hasStarted,
  isValidDate,
  isValidStamp,
  nowStamp,
  occupiedRange,
  overlaps,
  slotStatuses,
} from '../lib/slots.js';

const router = Router();
const VIEWS = ['upcoming', 'past', 'cancelled'];
const MAX_BLOCK_DAYS = 366;
const PAGE_SIZE = 10;

router.use(barberAuth);

async function findConfirmed(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Booking not found');
  const booking = await Booking.findById(id).lean();
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status === 'cancelled') throw new ApiError(409, 'This booking is already cancelled');
  if (hasStarted(booking.date, booking.time)) {
    throw new ApiError(400, 'This appointment has already started or passed');
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

    // An appointment counts as past once its slot has ended.
    const now = nowInShop();
    const [h, m] = now.time.split(':').map(Number);
    const minutes = h * 60 + m - SLOT_MINUTES;
    const cutoff = minutes < 0 ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

    let filter;
    let sort;
    if (view === 'cancelled') {
      filter = { status: 'cancelled' };
      sort = { date: -1, time: -1, _id: -1 };
    } else if (view === 'upcoming') {
      filter = { status: 'confirmed', $or: [{ date: { $gt: now.date } }, { date: now.date, time: { $gt: cutoff } }] };
      sort = { date: 1, time: 1, _id: 1 };
    } else {
      filter = { status: 'confirmed', $or: [{ date: { $lt: now.date } }, { date: now.date, time: { $lte: cutoff } }] };
      sort = { date: -1, time: -1, _id: -1 };
    }
    if (q) filter = { $and: [filter, searchFilter(q)] };

    res.json(await paginateByDay(filter, sort, page));
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
    await assertSlotOpen(date, time, { maxDaysAhead: RESCHEDULE_DAYS_AHEAD, duration: booking.totalDuration });

    try {
      const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: 'confirmed', date: booking.date, time: booking.time },
        {
          date,
          time,
          slots: coveredSlots(date, time, booking.totalDuration),
          rescheduledFrom: { date: booking.date, time: booking.time },
        },
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
    const { date, booking: bookingId } = req.query;
    if (!isValidDate(date)) throw new ApiError(400, 'Query param "date" must be formatted as YYYY-MM-DD');
    // When picking a new time for a booking, judge slots by its duration and ignore its current spot.
    let options = {};
    if (bookingId !== undefined) {
      if (!mongoose.isValidObjectId(bookingId)) throw new ApiError(404, 'Booking not found');
      const booking = await Booking.findById(bookingId).select('totalDuration').lean();
      if (!booking) throw new ApiError(404, 'Booking not found');
      options = { duration: booking.totalDuration, excludeId: booking._id };
    }
    if (isClosedOn(date)) return res.json({ date, closed: true, slots: [] });
    res.json({ date, closed: false, slots: await slotStatuses(date, options) });
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
      (b) => overlaps(range, occupiedRange(b.date, b.time, b.totalDuration)) && !hasStarted(b.date, b.time)
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
