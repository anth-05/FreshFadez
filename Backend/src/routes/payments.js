import express, { Router } from 'express';
import mongoose from 'mongoose';
import Booking from '../models/Booking.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { bookingFee, paymentsEnabled, syncPayment } from '../lib/mollie.js';

const router = Router();

// Tells the website whether booking asks for the reservation fee, and how much it is.
router.get('/config', (req, res) => {
  res.json({ enabled: paymentsEnabled(), fee: bookingFee() });
});

// Mollie posts `id=tr_…` whenever a payment changes. Only the id is trusted; the status is
// fetched from Mollie. A 5xx makes Mollie retry later.
router.post(
  '/webhook',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !id.startsWith('tr_')) throw new ApiError(400, 'Missing payment id');
    try {
      await syncPayment(id);
    } catch (err) {
      // An id we don't know is acknowledged so Mollie stops retrying it.
      if (err.status !== 404 && err.mollieStatus !== 404) throw err;
    }
    res.status(200).end();
  })
);

// What the website shows when the customer comes back from Mollie. Leaves out personal details,
// since anyone with the booking id in the return link can call it.
router.get(
  '/bookings/:id',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Booking not found');
    let booking = await Booking.findById(req.params.id);
    if (!booking?.payment) throw new ApiError(404, 'Booking not found');
    // The webhook may not have arrived yet (or can't, locally), so check Mollie directly.
    if (['open', 'pending', 'authorized'].includes(booking.payment.status) && paymentsEnabled()) {
      booking = await syncPayment(booking.payment.molliePaymentId);
    }
    res.json({
      status: booking.status,
      paymentStatus: booking.payment.status,
      fee: booking.payment.amount,
      date: booking.date,
      time: booking.time,
      services: booking.services.map((s) => ({ slug: s.slug, name: s.name, price: s.price })),
      totalPrice: booking.totalPrice,
    });
  })
);

export default router;
