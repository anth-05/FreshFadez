import Block from '../models/Block.js';
import Booking from '../models/Booking.js';
import { ApiError } from '../middleware/errors.js';
import { TIME_SLOTS, SLOT_MINUTES, isClosedOn, nowInShop, addDays, addMinutes } from '../config/businessHours.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

export function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  return new Date(`${str}T00:00:00Z`).toISOString().slice(0, 10) === str;
}

// 'YYYY-MM-DDTHH:mm', where '24:00' is allowed to mean the end of that day.
export function isValidStamp(str) {
  const m = typeof str === 'string' && str.match(STAMP_RE);
  if (!m || !isValidDate(m[1])) return false;
  const h = Number(m[2]);
  const min = Number(m[3]);
  return (h < 24 && min < 60) || (h === 24 && min === 0);
}

export function slotRange(date, time) {
  return { start: `${date}T${time}`, end: `${date}T${addMinutes(time, SLOT_MINUTES)}` };
}

export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

// The time a booking takes up: its full duration, but never less than one slot.
export function occupiedRange(date, time, duration = SLOT_MINUTES) {
  return { start: `${date}T${time}`, end: `${date}T${addMinutes(time, Math.max(duration, SLOT_MINUTES))}` };
}

// Every slot a booking overlaps. A 105-minute booking at 12:00 holds 12:00 and 13:00; one at 15:00
// runs into the afternoon break and only holds 15:00.
export function coveredSlots(date, time, duration = SLOT_MINUTES) {
  const range = occupiedRange(date, time, duration);
  return TIME_SLOTS.filter((t) => overlaps(range, slotRange(date, t)));
}

// Bookings made before slots were stored only hold their start time.
export function slotsOf(booking) {
  return booking.slots?.length ? booking.slots : [booking.time];
}

export function nowStamp(now = nowInShop()) {
  return `${now.date}T${now.time}`;
}

// A slot counts as past once it has started.
export function hasStarted(date, time, now = nowInShop()) {
  return slotRange(date, time).start <= nowStamp(now);
}

export function blocksOverlapping(range) {
  return Block.find({ start: { $lt: range.end }, end: { $gt: range.start } }).sort({ start: 1 }).lean();
}

function dayRange(date) {
  return { start: `${date}T00:00`, end: `${date}T24:00` };
}

// Every slot on a day with why it is or isn't bookable for a booking of `duration` minutes:
// free, booked, blocked, past, or no_room (the slot is free but the booking would run into
// a later booking or block). `excludeId` leaves out the booking being rescheduled.
export async function slotStatuses(date, { duration = SLOT_MINUTES, excludeId } = {}, now = nowInShop()) {
  const filter = { date, status: 'confirmed' };
  if (excludeId) filter._id = { $ne: excludeId };
  const [bookings, blocks] = await Promise.all([
    Booking.find(filter).select('time slots').lean(),
    blocksOverlapping(dayRange(date)),
  ]);
  const taken = new Set(bookings.flatMap(slotsOf));
  return TIME_SLOTS.map((time) => {
    let status = 'free';
    if (taken.has(time)) status = 'booked';
    else if (blocks.some((b) => overlaps(b, slotRange(date, time)))) status = 'blocked';
    else if (hasStarted(date, time, now)) status = 'past';
    else {
      const range = occupiedRange(date, time, duration);
      const fits = coveredSlots(date, time, duration).every((t) => !taken.has(t)) && !blocks.some((b) => overlaps(b, range));
      if (!fits) status = 'no_room';
    }
    return { time, status };
  });
}

// Throws unless a booking of `duration` minutes can start at (date, time). Whether another booking
// already holds one of its slots is left to the unique index on Booking, the only race-free check.
export async function assertSlotOpen(date, time, { maxDaysAhead, duration = SLOT_MINUTES }) {
  if (!isValidDate(date)) throw new ApiError(400, 'date must be a real date formatted as YYYY-MM-DD');
  if (!TIME_SLOTS.includes(time)) throw new ApiError(400, 'Invalid time slot');
  const now = nowInShop();
  if (date < now.date) throw new ApiError(400, 'date cannot be in the past');
  if (date > addDays(now.date, maxDaysAhead)) {
    throw new ApiError(400, `date must be within ${maxDaysAhead} days`);
  }
  if (isClosedOn(date)) throw new ApiError(400, 'Selected date is closed');
  if (hasStarted(date, time, now)) throw new ApiError(409, 'That time has already passed, please pick another one');
  const blocks = await blocksOverlapping(occupiedRange(date, time, duration));
  if (blocks.length) throw new ApiError(409, 'That time is not available, please pick another one');
}

// Fills `slots` for bookings stored before it existed. If old data already overlaps, the later
// booking is left without slots (it then only holds its start time, see slotsOf) and is reported
// on every start until the barber reschedules it.
export async function backfillBookingSlots() {
  const missing = await Booking.find({ slots: { $exists: false } }).sort({ createdAt: 1 }).lean();
  const overlapping = [];
  let updated = 0;
  for (const b of missing) {
    try {
      await Booking.updateOne({ _id: b._id }, { slots: coveredSlots(b.date, b.time, b.totalDuration) });
      updated++;
    } catch (err) {
      if (err.code !== 11000) throw err;
      if (b.status === 'confirmed') overlapping.push(b);
    }
  }
  return { updated, overlapping };
}
