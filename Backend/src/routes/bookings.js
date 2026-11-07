import { Router } from 'express';
import Booking from '../models/Booking.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { BOOKABLE_DAYS_AHEAD } from '../config/businessHours.js';
import { createBooking, parseCustomer } from '../lib/newBooking.js';

const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { saveInfo = true, newsletter = false, date, time, serviceSlugs } = req.body ?? {};
    const booking = await createBooking({
      customer: parseCustomer(req.body),
      serviceSlugs,
      date,
      time,
      maxDaysAhead: BOOKABLE_DAYS_AHEAD,
      extra: { saveInfo: !!saveInfo, newsletter: !!newsletter },
    });
    res.status(201).json(booking);
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
