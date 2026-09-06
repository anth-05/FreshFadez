import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Service from '../src/models/Service.js';
import { TIME_SLOTS } from '../src/config/businessHours.js';
import { startTestServer, stopTestServer, resetDB } from './helpers/testServer.js';

let app;

before(async () => {
  app = await startTestServer();
});

after(stopTestServer);

beforeEach(resetDB);

function nextWeekday(weekday) {
  const d = new Date();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== weekday);
  return d.toISOString().slice(0, 10);
}

function validPayload(overrides = {}) {
  const monday = nextWeekday(1);
  return {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '0612345678',
    serviceSlugs: ['contour'],
    date: monday,
    time: TIME_SLOTS[0],
    ...overrides,
  };
}

test('POST /api/bookings creates a booking for valid input', async () => {
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });

  const res = await request(app).post('/api/bookings').send(validPayload());

  assert.equal(res.status, 201);
  assert.equal(res.body.totalPrice, 20);
  assert.equal(res.body.totalDuration, 30);
  assert.equal(res.body.status, 'confirmed');
});

test('POST /api/bookings rejects an unknown service slug', async () => {
  const res = await request(app).post('/api/bookings').send(validPayload({ serviceSlugs: ['nope'] }));
  assert.equal(res.status, 400);
});

test('POST /api/bookings rejects double-booking the same slot', async () => {
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });
  const payload = validPayload();

  const first = await request(app).post('/api/bookings').send(payload);
  assert.equal(first.status, 201);

  const second = await request(app).post('/api/bookings').send({ ...payload, email: 'other@example.com' });
  assert.equal(second.status, 409);
});

test('GET /api/bookings requires the admin API key', async () => {
  const res = await request(app).get('/api/bookings');
  assert.equal(res.status, 401);
});

test('GET /api/bookings lists bookings for an authenticated admin', async () => {
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });
  await request(app).post('/api/bookings').send(validPayload());

  const res = await request(app).get('/api/bookings').set('x-api-key', process.env.ADMIN_API_KEY);

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
});

test('PATCH /api/bookings/:id cancels a booking, freeing the slot', async () => {
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });
  const payload = validPayload();
  const created = await request(app).post('/api/bookings').send(payload);

  const cancelled = await request(app)
    .patch(`/api/bookings/${created.body._id}`)
    .set('x-api-key', process.env.ADMIN_API_KEY)
    .send({ status: 'cancelled' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');

  const rebooked = await request(app).post('/api/bookings').send({ ...payload, email: 'other@example.com' });
  assert.equal(rebooked.status, 201);
});
