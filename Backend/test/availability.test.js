import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Booking from '../src/models/Booking.js';
import { startTimes } from '../src/config/businessHours.js';
import { startTestServer, stopTestServer, resetDB } from './helpers/testServer.js';

// The tests book on Mondays; these are that day's whole-hour start times.
const TIME_SLOTS = startTimes(1);

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

test('GET /api/availability follows the opening hours of each day', async () => {
  const times = async (weekday, duration) => {
    const res = await request(app).get('/api/availability').query({ date: nextWeekday(weekday), ...(duration && { duration }) });
    return res.body.slots.filter((s) => s.available).map((s) => s.time);
  };
  assert.deepEqual(await times(1), ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']);
  assert.deepEqual(await times(5), ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']);
  assert.deepEqual(await times(6), ['10:00', '11:00', '12:00', '13:00']);
  // A 105-minute booking must be over by closing time (14:00 on Saturday).
  assert.deepEqual(await times(6, 105), ['10:00', '11:00', '12:00']);
});

