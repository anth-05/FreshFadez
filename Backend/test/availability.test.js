import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Booking from '../src/models/Booking.js';
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

test('GET /api/availability requires a valid date query param', async () => {
  const res = await request(app).get('/api/availability').query({ date: 'not-a-date' });
  assert.equal(res.status, 400);
});

test('GET /api/availability marks Sundays as closed', async () => {
  const sunday = nextWeekday(0);
  const res = await request(app).get('/api/availability').query({ date: sunday });
  assert.equal(res.status, 200);
  assert.equal(res.body.closed, true);
  assert.deepEqual(res.body.slots, []);
});

test('GET /api/availability excludes booked slots', async () => {
  const monday = nextWeekday(1);
  await Booking.create({
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '0612345678',
    services: [{ slug: 'contour', name: 'Contour', price: 20, duration: 30 }],
    date: monday,
    time: TIME_SLOTS[0],
    totalPrice: 20,
    totalDuration: 30,
  });

  const res = await request(app).get('/api/availability').query({ date: monday });

  assert.equal(res.status, 200);
  const slot = res.body.slots.find((s) => s.time === TIME_SLOTS[0]);
  assert.equal(slot.available, false);
  assert.equal(res.body.slots.length, TIME_SLOTS.length);
});
