import Block from '../models/Block.js';
import Booking from '../models/Booking.js';
import { ApiError } from '../middleware/errors.js';
import { SLOT_MINUTES, isClosedOn, hoursOn, timeSlotsOn, nowInShop, addDays, addMinutes } from '../config/businessHours.js';

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

// The agenda is kept in quarter-hour units, so the barber can shorten an appointment and plan
// someone else in the time that frees up. Customers online still pick whole-hour start times.
export const UNIT_MINUTES = 15;
export const MAX_LENGTH = 180;

// Every quarter hour the shop is open on a date; the barber can start an appointment on any of them.
export function quarterTimesOn(date) {
  const hours = hoursOn(date);
  const out = [];
  if (!hours) return out;
  for (let t = hours.open; t < hours.close; t = addMinutes(t, UNIT_MINUTES)) out.push(t);
  return out;
}

// Online bookings must be over by closing time; the barber may plan past it.
function endsByClosing(date, time, length) {
  const hours = hoursOn(date);
  return Boolean(hours) && addMinutes(time, length) <= hours.close;
}

export function slotRange(date, time, minutes = SLOT_MINUTES) {
  return { start: `${date}T${time}`, end: `${date}T${addMinutes(time, minutes)}` };
}

export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

// Online bookings take up at least one whole hour, however short the services are.
export function onlineLength(totalDuration) {
  return Math.max(totalDuration, SLOT_MINUTES);
}

// Barber-planned appointments default to the services' own duration, rounded up to a quarter.
export function quarterLength(totalDuration) {
  return Math.min(Math.max(Math.ceil(totalDuration / UNIT_MINUTES), 1) * UNIT_MINUTES, MAX_LENGTH);
}

// How long a booking takes up in the agenda. Bookings stored before `length` existed used the online rule.
export function lengthOf(booking) {
  return booking.length ?? onlineLength(booking.totalDuration ?? SLOT_MINUTES);
}

export function assertValidLength(length) {
  if (!Number.isInteger(length) || length < UNIT_MINUTES || length > MAX_LENGTH || length % UNIT_MINUTES) {
    throw new ApiError(400, `length must be ${UNIT_MINUTES} to ${MAX_LENGTH} minutes, in steps of ${UNIT_MINUTES}`);
  }
}

export function occupiedRange(date, time, length) {
  return slotRange(date, time, length);
}

// Every quarter-hour unit a booking overlaps while the shop is open. A 105-minute booking at 12:00
// holds 12:00 up to 13:30; one the barber plans at 20:30 on a Monday only holds 20:30 and 20:45.
export function coveredSlots(date, time, length) {
  const range = occupiedRange(date, time, length);
  return quarterTimesOn(date).filter((t) => overlaps(range, slotRange(date, t, UNIT_MINUTES)));
}

// The fields that place a booking in the agenda.
export function placement(date, time, length) {
  return { date, time, length, end: addMinutes(time, length), slots: coveredSlots(date, time, length) };
}

// Bookings whose slots could not be stored (old overlapping data) are judged by their computed range.
export function slotsOf(booking) {
  return booking.slots?.length ? booking.slots : coveredSlots(booking.date, booking.time, lengthOf(booking));
}

export function nowStamp(now = nowInShop()) {
  return `${now.date}T${now.time}`;
}

// A slot counts as past once it has started.
export function hasStarted(date, time, now = nowInShop()) {
  return slotRange(date, time).start <= nowStamp(now);
}

// An appointment is over once its length has passed.
export function hasEnded(booking, now = nowInShop()) {
  return occupiedRange(booking.date, booking.time, lengthOf(booking)).end <= nowStamp(now);
}

export function blocksOverlapping(range) {
  return Block.find({ start: { $lt: range.end }, end: { $gt: range.start } }).sort({ start: 1 }).lean();
}

function dayRange(date) {
  return { start: `${date}T00:00`, end: `${date}T24:00` };
}

// Every start time on a day with why it is or isn't bookable for a booking of `length` minutes:
// free, booked, blocked, past, or no_room (the start is free but the booking would run into
// a later booking or block, or for customers past closing time). Customers get whole hours; the
// barber (`quarters`) every quarter the shop is open.
// `excludeId` leaves out the booking being rescheduled.
export async function slotStatuses(date, { length = SLOT_MINUTES, excludeId, quarters = false } = {}, now = nowInShop()) {
  const filter = { date, status: 'confirmed' };
  if (excludeId) filter._id = { $ne: excludeId };
  const [bookings, blocks] = await Promise.all([
    Booking.find(filter).select('date time slots length totalDuration').lean(),
    blocksOverlapping(dayRange(date)),
  ]);
  const taken = new Set(bookings.flatMap(slotsOf));
  const starts = quarters ? quarterTimesOn(date) : timeSlotsOn(date);
  const step = quarters ? UNIT_MINUTES : SLOT_MINUTES;
  return starts.map((time) => {
    let status = 'free';
    if (taken.has(time)) status = 'booked';
    else if (blocks.some((b) => overlaps(b, slotRange(date, time, step)))) status = 'blocked';
    else if (hasStarted(date, time, now)) status = 'past';
    else {
      const range = occupiedRange(date, time, length);
      const fits = coveredSlots(date, time, length).every((t) => !taken.has(t)) && !blocks.some((b) => overlaps(b, range)) &&
        (quarters || endsByClosing(date, time, length));
      if (!fits) status = 'no_room';
    }
    return { time, status };
  });
}

// Throws unless a booking of `length` minutes can start at (date, time). Whether another booking
// already holds one of its slots is left to the unique index on Booking, the only race-free check.
export async function assertSlotOpen(date, time, { maxDaysAhead, length, quarters = false }) {
  if (!isValidDate(date)) throw new ApiError(400, 'date must be a real date formatted as YYYY-MM-DD');
  if (!(quarters ? quarterTimesOn(date) : timeSlotsOn(date)).includes(time)) throw new ApiError(400, 'Invalid time slot');
  const now = nowInShop();
  if (date < now.date) throw new ApiError(400, 'date cannot be in the past');
  if (date > addDays(now.date, maxDaysAhead)) {
    throw new ApiError(400, `date must be within ${maxDaysAhead} days`);
  }
  if (isClosedOn(date)) throw new ApiError(400, 'Selected date is closed');
  if (hasStarted(date, time, now)) throw new ApiError(409, 'That time has already passed, please pick another one');
  if (!quarters && !endsByClosing(date, time, length)) {
    throw new ApiError(409, 'That appointment would run past closing time, please pick an earlier one');
  }
  const blocks = await blocksOverlapping(occupiedRange(date, time, length));
  if (blocks.length) throw new ApiError(409, 'That time is not available, please pick another one');
}

// Gives bookings stored before quarter-hour units existed their length, end and units. If old data
// already overlaps, the later booking keeps its length but holds no units (see slotsOf) and is
// reported on every start until the barber reschedules it.
export async function backfillBookingSlots() {
  const missing = await Booking.find({ $or: [{ length: { $exists: false } }, { slots: { $exists: false } }] })
    .sort({ createdAt: 1 })
    .lean();
  const overlapping = [];
  let updated = 0;
  for (const b of missing) {
    const place = placement(b.date, b.time, lengthOf(b));
    try {
      await Booking.updateOne({ _id: b._id }, place);
      updated++;
    } catch (err) {
      if (err.code !== 11000) throw err;
      const { slots, ...rest } = place;
      await Booking.updateOne({ _id: b._id }, { ...rest, $unset: { slots: 1 } });
      if (b.status === 'confirmed') overlapping.push(b);
    }
  }
  return { updated, overlapping };
}
