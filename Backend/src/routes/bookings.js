import { Router } from 'express';
import Booking from '../models/Booking.js';
import Service from '../models/Service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { TIME_SLOTS, BOOKABLE_DAYS_AHEAD, isClosedOn } from '../config/businessHours.js';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
    if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Invalid email address');
    if (!Array.isArray(serviceSlugs) || serviceSlugs.length === 0) {
      throw new ApiError(400, 'Select at least one service');
    }
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      throw new ApiError(400, 'date must be formatted as YYYY-MM-DD');
    }
    if (date < todayStr()) throw new ApiError(400, 'date cannot be in the past');
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + BOOKABLE_DAYS_AHEAD);
    if (date > maxDate.toISOString().slice(0, 10)) {
      throw new ApiError(400, `date must be within ${BOOKABLE_DAYS_AHEAD} days`);
    }
    if (isClosedOn(date)) throw new ApiError(400, 'Selected date is closed');
    if (!TIME_SLOTS.includes(time)) throw new ApiError(400, 'Invalid time slot');

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
        totalPrice,
        totalDuration,
      });
      res.status(201).json(booking);
    } catch (err) {
      if (err.code === 11000) {
        throw new ApiError(409, 'That time slot was just booked, please pick another one');
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
