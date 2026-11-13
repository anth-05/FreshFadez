import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Service from '../src/models/Service.js';
import Booking from '../src/models/Booking.js';
import { startTimes } from '../src/config/businessHours.js';
import { startTestServer, stopTestServer, resetDB } from './helpers/testServer.js';

// The tests book on Mondays; these are that day's whole-hour start times.
const TIME_SLOTS = startTimes(1);

let app;
const realFetch = globalThis.fetch;
// Stands in for Mollie: payments by id, and every request the API made.
let molliePayments;
let mollieCalls;

function fakeMollie(url, opts = {}) {
  const u = new URL(url);
  mollieCalls.push({ method: opts.method ?? 'GET', path: u.pathname, body: opts.body && JSON.parse(opts.body) });
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  if (opts.method === 'POST' && u.pathname === '/v2/payments') {
    const id = `tr_test${mollieCalls.length}`;
    molliePayments[id] = { id, status: 'open', _links: { checkout: { href: `https://mollie.test/checkout/${id}` } } };
    return json(201, molliePayments[id]);
  }
  const m = u.pathname.match(/^\/v2\/payments\/(.+)$/);
  if (m && molliePayments[m[1]]) return json(200, molliePayments[m[1]]);
  return json(404, { detail: 'Not found' });
}

before(async () => {
  app = await startTestServer();
});

after(stopTestServer);

beforeEach(async () => {
  await resetDB();
  molliePayments = {};
  mollieCalls = [];
  globalThis.fetch = fakeMollie;
  process.env.MOLLIE_API_KEY = 'test_key';
  process.env.FRONTEND_URL = 'https://freshfadez.test';
  process.env.API_PUBLIC_URL = 'https://api.freshfadez.test';
  delete process.env.BOOKING_FEE;
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MOLLIE_API_KEY;
  delete process.env.FRONTEND_URL;
  delete process.env.API_PUBLIC_URL;
});

function nextMonday() {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1);
  return d.toISOString().slice(0, 10);
}

function payload(overrides = {}) {
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '0612345678',
    serviceSlugs: ['contour'],
    date: nextMonday(),
    time: TIME_SLOTS[0],
    ...overrides,
  };
}

test('GET /api/payments/config reports the reservation fee', async () => {
  const res = await request(app).get('/api/payments/config');
  assert.deepEqual(res.body, { enabled: true, fee: 1.5 });
});

test('POST /api/bookings starts a €1.50 Mollie payment and returns the checkout link', async () => {
  const res = await request(app).post('/api/bookings').send(payload());

  assert.equal(res.status, 201);
  assert.match(res.body.checkoutUrl, /^https:\/\/mollie\.test\/checkout\//);
  assert.equal(res.body.payment.status, 'open');
  assert.equal(res.body.status, 'confirmed');

  const created = mollieCalls.find((c) => c.method === 'POST');
  assert.deepEqual(created.body.amount, { currency: 'EUR', value: '1.50' });
  assert.equal(created.body.redirectUrl, `https://freshfadez.test/?booking=${res.body._id}`);
  assert.equal(created.body.webhookUrl, 'https://api.freshfadez.test/api/payments/webhook');
});

test('an unpaid booking holds its slot', async () => {
  await request(app).post('/api/bookings').send(payload());
  const second = await request(app).post('/api/bookings').send(payload({ email: 'other@example.com' }));
  assert.equal(second.status, 409);
});

test('the webhook keeps a booking once the fee is paid', async () => {
  const res = await request(app).post('/api/bookings').send(payload());
  const id = res.body.payment.molliePaymentId;
  molliePayments[id].status = 'paid';

  const hook = await request(app).post('/api/payments/webhook').type('form').send({ id });
  assert.equal(hook.status, 200);

  const booking = await Booking.findById(res.body._id).lean();
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.payment.status, 'paid');
  assert.ok(booking.payment.paidAt);
});

test('an expired payment cancels the booking and frees the slot', async () => {
  const res = await request(app).post('/api/bookings').send(payload());
  const id = res.body.payment.molliePaymentId;
  molliePayments[id].status = 'expired';

  await request(app).post('/api/payments/webhook').type('form').send({ id });

  const booking = await Booking.findById(res.body._id).lean();
  assert.equal(booking.status, 'cancelled');
  const again = await request(app).post('/api/bookings').send(payload({ email: 'other@example.com' }));
  assert.equal(again.status, 201);
});

test('the webhook acknowledges unknown payments and rejects a missing id', async () => {
  const unknown = await request(app).post('/api/payments/webhook').type('form').send({ id: 'tr_unknown' });
  assert.equal(unknown.status, 200);
  const missing = await request(app).post('/api/payments/webhook').type('form').send({});
  assert.equal(missing.status, 400);
});

test('GET /api/payments/bookings/:id checks Mollie when the webhook has not arrived', async () => {
  const res = await request(app).post('/api/bookings').send(payload());
  molliePayments[res.body.payment.molliePaymentId].status = 'paid';

  const status = await request(app).get(`/api/payments/bookings/${res.body._id}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.paymentStatus, 'paid');
  assert.equal(status.body.status, 'confirmed');
  assert.equal(status.body.fee, 1.5);
  assert.equal(status.body.firstName, undefined);
  assert.equal(status.body.email, undefined);
});

test('a failed payment start cancels the booking', async () => {
  globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 500 }));
  const res = await request(app).post('/api/bookings').send(payload());
  assert.equal(res.status, 502);
  assert.equal(await Booking.countDocuments({ status: 'confirmed' }), 0);
});

test('without a Mollie key bookings are confirmed straight away', async () => {
  delete process.env.MOLLIE_API_KEY;
  const res = await request(app).post('/api/bookings').send(payload());
  assert.equal(res.status, 201);
  assert.equal(res.body.checkoutUrl, undefined);
  assert.equal(mollieCalls.length, 0);
});
