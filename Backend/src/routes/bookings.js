import { Router } from 'express';
import Booking from '../models/Booking.js';
import Service from '../models/Service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { BOOKABLE_DAYS_AHEAD } from '../config/businessHours.js';
import { assertSlotOpen, coveredSlots } from '../lib/slots.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s()-]+$/;
const LIMITS = { name: 50, email: 254, notes: 500 };

// 9–15 digits covers Dutch numbers (06…, 010…) and international ones (+31 6…).
function isValidPhone(phone) {
  const digits = phone.replace(/\D/g, '').length;
  return PHONE_RE.test(phone) && digits >= 9 && digits <= 15;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      firstName,
      lastName,
      email,
      phone,
      notes = '',
      saveInfo = true,
      newsletter = false,
      date,
      time,
      serviceSlugs,
    } = req.body ?? {};

    if (!firstName || !lastName || !email || !phone) {
      throw new ApiError(400, 'firstName, lastName, email and phone are required');
    }
    if ([firstName, lastName, email, phone, notes].some((v) => typeof v !== 'string')) {
      throw new ApiError(400, 'firstName, lastName, email, phone and notes must be text');
    }
    if (!firstName.trim() || !lastName.trim()) throw new ApiError(400, 'firstName and lastName are required');
    if (firstName.length > LIMITS.name || lastName.length > LIMITS.name) {
      throw new ApiError(400, `Names can be at most ${LIMITS.name} characters`);
    }
    if (email.length > LIMITS.email || !EMAIL_RE.test(email)) throw new ApiError(400, 'Invalid email address');
    if (!isValidPhone(phone)) throw new ApiError(400, 'Invalid phone number');
    if (notes.length > LIMITS.notes) throw new ApiError(400, `notes can be at most ${LIMITS.notes} characters`);
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
    await assertSlotOpen(date, time, { maxDaysAhead: BOOKABLE_DAYS_AHEAD, duration: totalDuration });

    try {
      const booking = await Booking.create({
        firstName,
        lastName,
        email,
        phone,
        notes,
        saveInfo: !!saveInfo,
        newsletter: !!newsletter,
        services: bookedServices,
        date,
        time,
        slots: coveredSlots(date, time, totalDuration),
        totalPrice,
        totalDuration,
      });
      res.status(201).json(booking);
    } catch (err) {
      if (err.code === 11000) {
        throw new ApiError(409, 'That time is no longer available, please pick another one');
      }
      throw err;
    }
  })
);

router.use(adminAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date, status } = req.query;
    const filter = {};
    if (date) filter.date = date;
    if (status) filter.status = status;
    const bookings = await Booking.find(filter).sort({ date: 1, time: 1 }).lean();
    res.json(bookings);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) throw new ApiError(404, 'Booking not found');
    res.json(booking);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { status } = req.body ?? {};
    if (!['confirmed', 'cancelled'].includes(status)) {
      throw new ApiError(400, 'status must be "confirmed" or "cancelled"');
    }
    const booking = await Booking.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!booking) throw new ApiError(404, 'Booking not found');
    res.json(booking);
  })
);

export default router;
