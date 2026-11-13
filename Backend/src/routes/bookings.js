import { Router } from 'express';
import Booking from '../models/Booking.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { BOOKABLE_DAYS_AHEAD } from '../config/businessHours.js';
import { createBooking, parseCustomer } from '../lib/newBooking.js';
import { bookingFee, createBookingPayment, paymentsEnabled } from '../lib/mollie.js';

const router = Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { date, time, serviceSlugs, acceptedPolicy } = req.body ?? {};
    const customer = parseCustomer(req.body);
    if (acceptedPolicy !== true) throw new ApiError(400, 'You have to agree with the policy & terms to book');
    const booking = await createBooking({
      customer,
      serviceSlugs,
      date,
      time,
      maxDaysAhead: BOOKABLE_DAYS_AHEAD,
      extra: { policyAcceptedAt: new Date() },
    });
    if (!paymentsEnabled()) return res.status(201).json(booking);

    // The booking holds its slot while the customer pays the reservation fee at Mollie.
    const redirectBase = process.env.FRONTEND_URL || req.get('origin');
    let payment;
    try {
      if (!redirectBase) throw new Error('FRONTEND_URL is not set');
      payment = await createBookingPayment(booking, { redirectBase, locale: req.body.lang });
    } catch (err) {
      console.error(err);
      await Booking.updateOne({ _id: booking._id }, { status: 'cancelled', cancelledAt: new Date() });
      throw new ApiError(502, 'The payment could not be started, please try again');
    }
    booking.payment = { molliePaymentId: payment.id, status: payment.status, amount: bookingFee() };
    await booking.save();
    res.status(201).json({ ...booking.toJSON(), checkoutUrl: payment.checkoutUrl });
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
