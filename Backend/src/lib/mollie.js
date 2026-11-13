import Booking from '../models/Booking.js';
import { ApiError } from '../middleware/errors.js';

const MOLLIE_API = 'https://api.mollie.com/v2';

// Online bookings only ask for a payment when a Mollie key is configured; without one
// (local development, tests) a booking is confirmed straight away as before.
export function paymentsEnabled() {
  return Boolean(process.env.MOLLIE_API_KEY);
}

// The reservation fee paid online; the appointment itself is paid in the shop.
export function bookingFee() {
  const fee = Number(process.env.BOOKING_FEE ?? '1.50');
  return Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) / 100 : 1.5;
}

async function mollie(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${MOLLIE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.MOLLIE_API_KEY}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Mollie ${method} ${path} failed: ${res.status} ${data.detail ?? ''}`.trim());
    err.mollieStatus = res.status;
    throw err;
  }
  return data;
}

// Starts the reservation-fee payment for a booking and returns Mollie's checkout link.
// Mollie can only reach a public webhook, so locally the status is read when the customer returns.
export async function createBookingPayment(booking, { redirectBase, locale = 'nl' }) {
  const webhookBase = process.env.API_PUBLIC_URL;
  const payment = await mollie('/payments', {
    method: 'POST',
    body: {
      amount: { currency: 'EUR', value: bookingFee().toFixed(2) },
      description: `Fresh Fadez Studios reservering ${booking.date} ${booking.time}`,
      redirectUrl: `${redirectBase.replace(/\/$/, '')}/?booking=${booking._id}`,
      ...(webhookBase && { webhookUrl: `${webhookBase.replace(/\/$/, '')}/api/payments/webhook` }),
      locale: locale === 'en' ? 'en_US' : 'nl_NL',
      metadata: { bookingId: String(booking._id) },
    },
  });
  return { id: payment.id, status: payment.status, checkoutUrl: payment._links?.checkout?.href };
}

const FAILED = ['canceled', 'expired', 'failed'];

// Reads a payment's current status from Mollie (never from the webhook body) and applies it:
// a paid fee keeps the booking, a failed one cancels it so the slot opens up again.
export async function syncPayment(paymentId) {
  const payment = await mollie(`/payments/${encodeURIComponent(paymentId)}`);
  const booking = await Booking.findOne({ 'payment.molliePaymentId': payment.id });
  if (!booking) throw new ApiError(404, 'No booking for this payment');
  if (booking.payment.status === payment.status) return booking;

  booking.payment.status = payment.status;
  if (payment.status === 'paid') booking.payment.paidAt = new Date(payment.paidAt ?? Date.now());
  if (FAILED.includes(payment.status) && booking.status === 'confirmed') {
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
  }
  await booking.save();
  return booking;
}
