import Booking from '../models/Booking.js';
import Service from '../models/Service.js';
import { ApiError } from '../middleware/errors.js';
import { assertSlotOpen, assertValidLength, onlineLength, placement, quarterLength } from './slots.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s()-]+$/;
const LIMITS = { name: 50, email: 254, notes: 500 };

// 9–15 digits covers Dutch numbers (06…, 010…) and international ones (+31 6…).
function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '').length;
  return PHONE_RE.test(phone) && digits >= 9 && digits <= 15;
}

// Validates the customer details of a new booking. The barber may leave out the email
// (a walk-in or phone customer), customers booking online may not.
export function parseCustomer(body, { emailRequired = true } = {}) {
  const { firstName, lastName, phone, notes = '' } = body ?? {};
  const email = body?.email ?? '';
  if (!firstName || !lastName || !phone || (emailRequired && !email)) {
    throw new ApiError(400, emailRequired ? 'firstName, lastName, email and phone are required' : 'firstName, lastName and phone are required');
  }
  if ([firstName, lastName, email, phone, notes].some((v) => typeof v !== 'string')) {
    throw new ApiError(400, 'firstName, lastName, email, phone and notes must be text');
  }
  if (!firstName.trim() || !lastName.trim()) throw new ApiError(400, 'firstName and lastName are required');
  if (firstName.length > LIMITS.name || lastName.length > LIMITS.name) {
    throw new ApiError(400, `Names can be at most ${LIMITS.name} characters`);
  }
  if (email && (email.length > LIMITS.email || !EMAIL_RE.test(email))) throw new ApiError(400, 'Invalid email address');
  if (!isValidPhone(phone)) throw new ApiError(400, 'Invalid phone number');
  if (notes.length > LIMITS.notes) throw new ApiError(400, `notes can be at most ${LIMITS.notes} characters`);
  return { firstName, lastName, email, phone, notes };
}

// Creates a confirmed booking for the given services at (date, time), refusing anything that
// would overlap another booking or a blocked period. The barber (`byBarber`) may start on any
// quarter hour and choose the length; online bookings start on the hour and take at least an hour.
export async function createBooking({ customer, serviceSlugs, date, time, maxDaysAhead, byBarber = false, length, extra = {} }) {
  if (length !== undefined) assertValidLength(length);
  if (!Array.isArray(serviceSlugs) || serviceSlugs.length === 0) {
    throw new ApiError(400, 'Select at least one service');
  }
  const services = await Service.find({ slug: { $in: serviceSlugs }, active: true }).lean();
  if (services.length !== serviceSlugs.length) {
    throw new ApiError(400, 'One or more selected services are invalid');
  }

  const bookedServices = services.map((s) => ({
    slug: s.slug,
    name: s.name,
    price: s.price,
    duration: s.duration,
  }));
  const totalPrice = bookedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = bookedServices.reduce((sum, s) => sum + s.duration, 0);
  const agendaLength = length ?? (byBarber ? quarterLength(totalDuration) : onlineLength(totalDuration));
  await assertSlotOpen(date, time, { maxDaysAhead, length: agendaLength, quarters: byBarber });

  try {
    return await Booking.create({
      ...customer,
      ...extra,
      services: bookedServices,
      ...placement(date, time, agendaLength),
      totalPrice,
      totalDuration,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ApiError(409, 'That time is no longer available, please pick another one');
    }
    throw err;
  }
}
