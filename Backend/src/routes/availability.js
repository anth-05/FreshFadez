import { Router } from 'express';
import Booking from '../models/Booking.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { TIME_SLOTS, isClosedOn } from '../config/businessHours.js';

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      throw new ApiError(400, 'Query param "date" must be formatted as YYYY-MM-DD');
    }

    if (isClosedOn(date)) {
      return res.json({ date, closed: true, slots: [] });
    }

    const booked = await Booking.find({ date, status: 'confirmed' }).distinct('time');
    const bookedSet = new Set(booked);
    const slots = TIME_SLOTS.map((time) => ({ time, available: !bookedSet.has(time) }));
    res.json({ date, closed: false, slots });
  })
);

export default router;
