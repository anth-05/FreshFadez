import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Service from '../src/models/Service.js';
import Booking from '../src/models/Booking.js';
import { TIME_SLOTS, nowInShop, addDays } from '../src/config/businessHours.js';
import { hasStarted, isValidStamp, coveredSlots, backfillBookingSlots } from '../src/lib/slots.js';
import { startTestServer, stopTestServer, resetDB } from './helpers/testServer.js';

let app;
let token;

before(async () => {
  app = await startTestServer();
  await Booking.init(); // make sure the unique slot index exists before the race tests
});

after(stopTestServer);

beforeEach(async () => {
  await resetDB();
  await Service.create({ slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20 });
  await Service.create({ slug: 'knippen-baard', name: 'Knippen + baard', category: 'knippen', duration: 60, price: 50 });
  await Service.create({ slug: 'skin-fade', name: 'Skin fade', category: 'contour', duration: 45, price: 38 });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'test-password' });
  token = login.body.token;
});

function nextWeekday(weekday, after = 0) {
  const d = new Date(`${addDays(nowInShop().date, after)}T00:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() !== weekday);
  return d.toISOString().slice(0, 10);
}

const MONDAY = () => nextWeekday(1);
const TUESDAY = () => nextWeekday(2);
const SUNDAY = () => nextWeekday(0);

function book(date, time, overrides = {}) {
  return request(app)
    .post('/api/bookings')
    .send({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '0612345678',
      serviceSlugs: ['contour'],
      date,
      time,
      ...overrides,
    });
}

const barber = {
  get: (url) => request(app).get(`/api/barber${url}`).set('Authorization', `Bearer ${token}`),
  post: (url, body) => request(app).post(`/api/barber${url}`).set('Authorization', `Bearer ${token}`).send(body),
  del: (url) => request(app).delete(`/api/barber${url}`).set('Authorization', `Bearer ${token}`),
};

async function slotStatus(date, time) {
  const res = await barber.get(`/slots?date=${date}`);
  return res.body.slots.find((s) => s.time === time).status;
}

/* ---------------- Happy flow ---------------- */

test('happy flow: list, reschedule, cancel and rebook', async () => {
  const monday = MONDAY();
  const created = await book(monday, TIME_SLOTS[0]);
  assert.equal(created.status, 201);

  const upcoming = await barber.get('/bookings');
  assert.equal(upcoming.status, 200);
  assert.equal(upcoming.body.items.length, 1);

  const moved = await barber.post(`/bookings/${created.body._id}/reschedule`, { date: monday, time: TIME_SLOTS[2] });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.time, TIME_SLOTS[2]);
  assert.deepEqual(moved.body.rescheduledFrom, { date: monday, time: TIME_SLOTS[0] });
  assert.equal(await slotStatus(monday, TIME_SLOTS[0]), 'free');
  assert.equal(await slotStatus(monday, TIME_SLOTS[2]), 'booked');

  const cancelled = await barber.post(`/bookings/${created.body._id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
  assert.ok(cancelled.body.cancelledAt);
  assert.equal(await slotStatus(monday, TIME_SLOTS[2]), 'free');

  assert.equal((await barber.get('/bookings')).body.total, 0);
  assert.equal((await barber.get('/bookings?view=cancelled')).body.total, 1);

  const rebooked = await book(monday, TIME_SLOTS[2], { email: 'other@example.com' });
  assert.equal(rebooked.status, 201);
});

test('happy flow: block a period, customers cannot book it, unblock frees it again', async () => {
  const monday = MONDAY();
  const block = await barber.post('/blocks', { start: `${monday}T12:00`, end: `${monday}T14:00`, reason: 'Tandarts' });
  assert.equal(block.status, 201);

  const avail = await request(app).get('/api/availability').query({ date: monday });
  const byTime = Object.fromEntries(avail.body.slots.map((s) => [s.time, s.available]));
  assert.equal(byTime['12:00'], false);
  assert.equal(byTime['13:00'], false);
  assert.equal(byTime['14:00'], true);
  assert.equal(await slotStatus(monday, '12:00'), 'blocked');

  assert.equal((await book(monday, '12:00')).status, 409);
  assert.equal((await book(monday, '14:00')).status, 201);

  const list = await barber.get('/blocks');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].reason, 'Tandarts');

  assert.equal((await barber.del(`/blocks/${block.body._id}`)).status, 204);
  assert.equal((await book(monday, '12:00', { email: 'other@example.com' })).status, 201);
});

test('happy flow: a whole-day block over several days covers every slot', async () => {
  const monday = MONDAY();
  const tuesday = addDays(monday, 1);
  const res = await barber.post('/blocks', { start: `${monday}T00:00`, end: `${tuesday}T24:00` });
  assert.equal(res.status, 201);
  for (const date of [monday, tuesday]) {
    const avail = await request(app).get('/api/availability').query({ date });
    assert.ok(avail.body.slots.every((s) => !s.available), `${date} should be fully blocked`);
  }
  const wednesday = await request(app).get('/api/availability').query({ date: addDays(monday, 2) });
  assert.ok(wednesday.body.slots.every((s) => s.available));
});

test('a block that only partly overlaps a slot still blocks that slot', async () => {
  const monday = MONDAY();
  await barber.post('/blocks', { start: `${monday}T12:30`, end: `${monday}T12:45` });
  assert.equal(await slotStatus(monday, '12:00'), 'blocked');
  assert.equal(await slotStatus(monday, '13:00'), 'free');
});

/* ---------------- Double booking ---------------- */

test('double booking: two customers racing for the same slot, only one wins', async () => {
  const monday = MONDAY();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => book(monday, TIME_SLOTS[1], { email: `c${i}@example.com` }))
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
  assert.equal(await Booking.countDocuments({ date: monday, time: TIME_SLOTS[1], status: 'confirmed' }), 1);
});

test('double booking: rescheduling onto a taken slot is refused and leaves both bookings alone', async () => {
  const monday = MONDAY();
  const a = await book(monday, TIME_SLOTS[0]);
  await book(monday, TIME_SLOTS[1], { email: 'b@example.com' });

  const res = await barber.post(`/bookings/${a.body._id}/reschedule`, { date: monday, time: TIME_SLOTS[1] });
  assert.equal(res.status, 409);
  const still = await Booking.findById(a.body._id).lean();
  assert.equal(still.time, TIME_SLOTS[0]);
});

test('double booking: two bookings rescheduled into the same free slot at once, only one wins', async () => {
  const monday = MONDAY();
  const a = await book(monday, TIME_SLOTS[0]);
  const b = await book(monday, TIME_SLOTS[1], { email: 'b@example.com' });
  const results = await Promise.all([
    barber.post(`/bookings/${a.body._id}/reschedule`, { date: monday, time: TIME_SLOTS[4] }),
    barber.post(`/bookings/${b.body._id}/reschedule`, { date: monday, time: TIME_SLOTS[4] }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await Booking.countDocuments({ date: monday, time: TIME_SLOTS[4], status: 'confirmed' }), 1);
});

/* ---------------- Sad flow ---------------- */

test('sad flow: every barber route needs a valid session', async () => {
  const routes = [
    request(app).get('/api/barber/bookings'),
    request(app).get('/api/barber/blocks'),
    request(app).get(`/api/barber/slots?date=${MONDAY()}`),
    request(app).post('/api/barber/blocks').send({}),
    request(app).post('/api/barber/bookings/x/cancel'),
    request(app).post('/api/barber/bookings/x/reschedule').send({}),
    request(app).delete('/api/barber/blocks/x'),
    request(app).get('/api/barber/bookings').set('Authorization', 'Bearer garbage'),
  ];
  for (const res of await Promise.all(routes)) assert.equal(res.status, 401);
});

test('sad flow: cancelling twice, unknown ids and malformed ids', async () => {
  const created = await book(MONDAY(), TIME_SLOTS[0]);
  assert.equal((await barber.post(`/bookings/${created.body._id}/cancel`)).status, 200);
  assert.equal((await barber.post(`/bookings/${created.body._id}/cancel`)).status, 409);
  assert.equal((await barber.post('/bookings/64b000000000000000000000/cancel')).status, 404);
  assert.equal((await barber.post('/bookings/not-an-id/cancel')).status, 404);
  assert.equal((await barber.post(`/bookings/${created.body._id}/reschedule`, { date: TUESDAY(), time: '12:00' })).status, 409);
});

test('sad flow: two cancels at the same time, exactly one succeeds', async () => {
  const created = await book(MONDAY(), TIME_SLOTS[0]);
  const results = await Promise.all([
    barber.post(`/bookings/${created.body._id}/cancel`),
    barber.post(`/bookings/${created.body._id}/cancel`),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});

test('sad flow: past appointments cannot be cancelled or moved', async () => {
  const yesterday = addDays(nowInShop().date, -1);
  const old = await Booking.create({
    firstName: 'Old',
    lastName: 'Timer',
    email: 'old@example.com',
    phone: '0600000000',
    services: [{ slug: 'contour', name: 'Contour', price: 20, duration: 30 }],
    date: yesterday,
    time: '12:00',
    totalPrice: 20,
    totalDuration: 30,
  });
  assert.equal((await barber.post(`/bookings/${old._id}/cancel`)).status, 400);
  assert.equal((await barber.post(`/bookings/${old._id}/reschedule`, { date: MONDAY(), time: '12:00' })).status, 400);
  assert.equal((await barber.get('/bookings?view=past')).body.total, 1);
  assert.equal((await barber.get('/bookings')).body.total, 0);
});

test('sad flow: reschedule rejects bad targets', async () => {
  const monday = MONDAY();
  const created = await book(monday, TIME_SLOTS[0]);
  const id = created.body._id;
  const cases = [
    [{ date: monday, time: TIME_SLOTS[0] }, 400], // same slot
    [{ date: SUNDAY(), time: '12:00' }, 400], // closed
    [{ date: addDays(nowInShop().date, -1), time: '12:00' }, 400], // past
    [{ date: monday, time: '12:30' }, 400], // not a slot
    [{ date: '2026-02-31', time: '12:00' }, 400], // not a real date
    [{ date: addDays(nowInShop().date, 90), time: '12:00' }, 400], // too far out
    [{}, 400], // nothing sent
  ];
  for (const [body, status] of cases) {
    const res = await barber.post(`/bookings/${id}/reschedule`, body);
    assert.equal(res.status, status, `${JSON.stringify(body)} → ${res.status} ${res.body.error}`);
  }

  await barber.post('/blocks', { start: `${TUESDAY()}T00:00`, end: `${TUESDAY()}T24:00` });
  assert.equal((await barber.post(`/bookings/${id}/reschedule`, { date: TUESDAY(), time: '12:00' })).status, 409);

  const unchanged = await Booking.findById(id).lean();
  assert.equal(unchanged.date, monday);
  assert.equal(unchanged.time, TIME_SLOTS[0]);
});

test('sad flow: a block over existing appointments is refused and lists them', async () => {
  const monday = MONDAY();
  await book(monday, '13:00', { firstName: 'Ali' });
  const res = await barber.post('/blocks', { start: `${monday}T12:00`, end: `${monday}T15:00` });
  assert.equal(res.status, 409);
  assert.equal(res.body.details.length, 1);
  assert.equal(res.body.details[0].firstName, 'Ali');
  assert.equal(res.body.details[0].time, '13:00');
  assert.equal((await barber.get('/blocks')).body.length, 0);
});

test('blocking today does not trip over appointments that already happened', async () => {
  const today = nowInShop().date;
  await Booking.create({
    firstName: 'Earlier',
    lastName: 'Today',
    email: 'e@example.com',
    phone: '0600000000',
    services: [{ slug: 'contour', name: 'Contour', price: 20, duration: 30 }],
    date: today,
    time: '00:00',
    totalPrice: 20,
    totalDuration: 30,
  });
  const res = await barber.post('/blocks', { start: `${today}T00:00`, end: `${today}T24:00` });
  assert.equal(res.status, 201);
});

test('sad flow: invalid block input', async () => {
  const monday = MONDAY();
  const yesterday = addDays(nowInShop().date, -1);
  const cases = [
    {},
    { start: monday, end: monday },
    { start: `${monday}T14:00`, end: `${monday}T12:00` },
    { start: `${monday}T12:00`, end: `${monday}T12:00` },
    { start: `${monday}T25:00`, end: `${monday}T26:00` },
    { start: `${yesterday}T12:00`, end: `${yesterday}T14:00` },
    { start: `${monday}T12:00`, end: `${addDays(monday, 400)}T12:00` },
    { start: `${monday}T12:00`, end: `${monday}T14:00`, reason: 'x'.repeat(201) },
  ];
  for (const body of cases) {
    const res = await barber.post('/blocks', body);
    assert.equal(res.status, 400, `${JSON.stringify(body).slice(0, 80)} → ${res.status}`);
  }
  assert.equal((await barber.del('/blocks/64b000000000000000000000')).status, 404);
  assert.equal((await barber.del('/blocks/nope')).status, 404);
});

test('sad flow: unknown bookings view, bad page, overlong search and bad slot date', async () => {
  assert.equal((await barber.get('/bookings?view=everything')).status, 400);
  assert.equal((await barber.get('/bookings?page=0')).status, 400);
  assert.equal((await barber.get('/bookings?page=abc')).status, 400);
  assert.equal((await barber.get(`/bookings?q=${'x'.repeat(101)}`)).status, 400);
  assert.equal((await barber.get('/slots?date=tomorrow')).status, 400);
});

/* ---------------- Paging + search ---------------- */

async function seedDays(days) {
  // days: array of [dateOffsetFromMonday, count]
  const monday = MONDAY();
  const docs = [];
  for (const [offset, count] of days) {
    const date = addDays(monday, offset);
    for (let i = 0; i < count; i++) {
      docs.push({
        firstName: `P${offset}`,
        lastName: `N${i}`,
        email: `p${offset}n${i}@example.com`,
        phone: `06 1234 ${String(offset).padStart(2, '0')}${i}`,
        services: [{ slug: 'contour', name: 'Contour', price: 20, duration: 30 }],
        date,
        time: TIME_SLOTS[i],
        totalPrice: 20,
        totalDuration: 30,
      });
    }
  }
  await Booking.insertMany(docs);
}

test('paging: at most 10 per page and days are never split', async () => {
  await seedDays([[0, 7], [1, 7], [2, 3], [3, 7]]); // Mon 7, Tue 7, Wed 3, Thu 7 = 24
  const p1 = await barber.get('/bookings');
  assert.equal(p1.body.total, 24);
  assert.equal(p1.body.pages, 3);
  assert.equal(p1.body.items.length, 7); // Mon only: adding Tue would make 14
  const p2 = await barber.get('/bookings?page=2');
  assert.equal(p2.body.items.length, 10); // Tue 7 + Wed 3
  assert.equal(new Set(p2.body.items.map((b) => b.date)).size, 2);
  const p3 = await barber.get('/bookings?page=3');
  assert.equal(p3.body.items.length, 7);
  const beyond = await barber.get('/bookings?page=99');
  assert.equal(beyond.body.page, 3);
  const all = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((b) => b._id);
  assert.equal(new Set(all).size, 24); // nothing skipped or shown twice
});

test('paging: 10 or fewer fit on one page', async () => {
  await seedDays([[0, 5], [1, 5]]);
  const res = await barber.get('/bookings');
  assert.equal(res.body.pages, 1);
  assert.equal(res.body.items.length, 10);
});

test('search: by first name, full name, email and phone, case-insensitive', async () => {
  await book(MONDAY(), '12:00', { firstName: 'Ali', lastName: 'Yilmaz', email: 'ali@mail.nl', phone: '06-1234 5678' });
  await book(MONDAY(), '13:00', { firstName: 'Ben', lastName: 'de Vries', email: 'ben@mail.nl', phone: '0687654321' });
  const hits = async (q) => (await barber.get(`/bookings?q=${encodeURIComponent(q)}`)).body.items.map((b) => b.firstName);
  assert.deepEqual(await hits('ali'), ['Ali']);
  assert.deepEqual(await hits('ben de v'), ['Ben']);
  assert.deepEqual(await hits('BEN@MAIL'), ['Ben']);
  assert.deepEqual(await hits('12345678'), ['Ali']); // ignores the dash and space in the stored number
  assert.deepEqual(await hits('mail.nl'), ['Ali', 'Ben']);
  assert.deepEqual(await hits('nobody'), []);
  assert.deepEqual(await hits('.*'), []); // regex characters are taken literally
});

test('search is scoped to the view', async () => {
  const a = await book(MONDAY(), '12:00', { firstName: 'Ali' });
  await book(MONDAY(), '13:00', { firstName: 'Ali', email: 'ali2@example.com' });
  await barber.post(`/bookings/${a.body._id}/cancel`);
  assert.equal((await barber.get('/bookings?q=ali')).body.total, 1);
  assert.equal((await barber.get('/bookings?view=cancelled&q=ali')).body.total, 1);
  assert.equal((await barber.get('/bookings?view=past&q=ali')).body.total, 0);
});

/* ---------------- Long appointments ---------------- */

const LONG = ['knippen-baard', 'skin-fade']; // 105 minutes

test('coveredSlots: long bookings hold every slot they overlap, but not across the break', () => {
  assert.deepEqual(coveredSlots('2026-11-02', '12:00', 105), ['12:00', '13:00']);
  assert.deepEqual(coveredSlots('2026-11-02', '12:00', 30), ['12:00']);
  assert.deepEqual(coveredSlots('2026-11-02', '12:00', 60), ['12:00']);
  assert.deepEqual(coveredSlots('2026-11-02', '12:00', 61), ['12:00', '13:00']);
  assert.deepEqual(coveredSlots('2026-11-02', '15:00', 105), ['15:00']);
  assert.deepEqual(coveredSlots('2026-11-02', '18:00', 150), ['18:00', '19:00', '20:00']);
});

test('overlap: a 105-minute booking at 12:00 also takes 13:00', async () => {
  const monday = MONDAY();
  const long = await book(monday, '12:00', { serviceSlugs: LONG });
  assert.equal(long.status, 201);
  assert.deepEqual(long.body.slots, ['12:00', '13:00']);

  assert.equal((await book(monday, '13:00', { email: 'b@example.com' })).status, 409);
  const avail = await request(app).get('/api/availability').query({ date: monday });
  const byTime = Object.fromEntries(avail.body.slots.map((s) => [s.time, s.available]));
  assert.equal(byTime['13:00'], false);
  assert.equal(byTime['14:00'], true);
  assert.equal(await slotStatus(monday, '13:00'), 'booked');
});

test('overlap: a long booking cannot start where it would run into the next booking', async () => {
  const monday = MONDAY();
  await book(monday, '13:00');
  assert.equal((await book(monday, '12:00', { serviceSlugs: LONG, email: 'long@example.com' })).status, 409);
  assert.equal((await book(monday, '12:00', { email: 'short@example.com' })).status, 201);

  const forLong = await request(app).get('/api/availability').query({ date: monday, duration: 105 });
  const forShort = await request(app).get('/api/availability').query({ date: monday, duration: 30 });
  const at = (res, t) => res.body.slots.find((s) => s.time === t).available;
  assert.equal(at(forLong, '14:00'), true);
  assert.equal(at(forLong, '15:00'), true); // runs into the break, not into a booking
  await book(monday, '19:00', { email: 'c@example.com' });
  const later = await request(app).get('/api/availability').query({ date: monday, duration: 105 });
  assert.equal(at(later, '18:00'), false); // would run into 19:00
  assert.equal(at(forShort, '18:00'), true);
});

test('overlap: a long booking cannot run into a blocked period', async () => {
  const monday = MONDAY();
  await barber.post('/blocks', { start: `${monday}T13:15`, end: `${monday}T13:45` });
  assert.equal((await book(monday, '12:00', { serviceSlugs: LONG })).status, 409);
  assert.equal((await book(monday, '12:00')).status, 201);
});

test('overlap race: a long and a short booking for overlapping slots at once, only one wins', async () => {
  for (let round = 0; round < 5; round++) {
    await Booking.deleteMany({});
    const monday = MONDAY();
    const results = await Promise.all([
      book(monday, '12:00', { serviceSlugs: LONG, email: 'long@example.com' }),
      book(monday, '13:00', { email: 'short@example.com' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], `round ${round}`);
  }
});

test('overlap: rescheduling respects the booking length, and can shift into its own time', async () => {
  const monday = MONDAY();
  const long = await book(monday, '12:00', { serviceSlugs: LONG });
  await book(monday, '19:00', { email: 'b@example.com' });

  const picker = await barber.get(`/slots?date=${monday}&booking=${long.body._id}`);
  const st = Object.fromEntries(picker.body.slots.map((s) => [s.time, s.status]));
  assert.equal(st['12:00'], 'free'); // its own spot doesn't count against it
  assert.equal(st['18:00'], 'no_room');
  assert.equal(st['19:00'], 'booked');

  assert.equal((await barber.post(`/bookings/${long.body._id}/reschedule`, { date: monday, time: '18:00' })).status, 409);
  const shifted = await barber.post(`/bookings/${long.body._id}/reschedule`, { date: monday, time: '13:00' });
  assert.equal(shifted.status, 200);
  assert.deepEqual(shifted.body.slots, ['13:00', '14:00']);
  assert.equal((await book(monday, '12:00', { email: 'c@example.com' })).status, 201); // 12:00 freed
  assert.equal((await book(monday, '14:00', { email: 'd@example.com' })).status, 409); // 14:00 taken
});

test('overlap: blocking over the second hour of a long booking is refused', async () => {
  const monday = MONDAY();
  await book(monday, '12:00', { serviceSlugs: LONG, firstName: 'Lang' });
  const res = await barber.post('/blocks', { start: `${monday}T13:30`, end: `${monday}T14:00` });
  assert.equal(res.status, 409);
  assert.equal(res.body.details[0].firstName, 'Lang');
});

test('overlap: cancelling a long booking frees all its slots', async () => {
  const monday = MONDAY();
  const long = await book(monday, '12:00', { serviceSlugs: LONG });
  await barber.post(`/bookings/${long.body._id}/cancel`);
  assert.equal((await book(monday, '12:00', { email: 'a@example.com' })).status, 201);
  assert.equal((await book(monday, '13:00', { email: 'b@example.com' })).status, 201);
});

test('backfill fills slots for old bookings and reports overlaps it cannot resolve', async () => {
  const monday = MONDAY();
  const base = { phone: '0612345678', services: [{ slug: 'x', name: 'X', price: 1, duration: 105 }], totalPrice: 1, date: monday };
  // Written straight to the collection, like bookings made before slots existed.
  const { insertedIds } = await Booking.collection.insertMany([
    { ...base, firstName: 'Old', lastName: 'Long', email: 'a@x.nl', time: '12:00', totalDuration: 105, status: 'confirmed', createdAt: new Date(1) },
    { ...base, firstName: 'Old', lastName: 'Clash', email: 'b@x.nl', time: '13:00', totalDuration: 30, status: 'confirmed', createdAt: new Date(2) },
    { ...base, firstName: 'Old', lastName: 'Fine', email: 'c@x.nl', time: '18:00', totalDuration: 30, status: 'confirmed', createdAt: new Date(3) },
  ]);
  const { updated, overlapping } = await backfillBookingSlots();
  assert.equal(updated, 2);
  assert.deepEqual(overlapping.map((b) => b.lastName), ['Clash']);
  assert.deepEqual((await Booking.findById(insertedIds[0]).lean()).slots, ['12:00', '13:00']);
  assert.equal((await Booking.findById(insertedIds[1]).lean()).slots, undefined);
  assert.equal(await slotStatus(monday, '13:00'), 'booked');
  assert.equal((await backfillBookingSlots()).overlapping.length, 1); // still reported next start
});

/* ---------------- Time helpers ---------------- */

test('hasStarted compares in shop time', () => {
  const now = { date: '2026-11-02', time: '13:30' };
  assert.equal(hasStarted('2026-11-02', '13:00', now), true);
  assert.equal(hasStarted('2026-11-02', '14:00', now), false);
  assert.equal(hasStarted('2026-11-01', '20:00', now), true);
});

test('isValidStamp accepts 24:00 as end of day only', () => {
  assert.equal(isValidStamp('2026-11-02T24:00'), true);
  assert.equal(isValidStamp('2026-11-02T24:30'), false);
  assert.equal(isValidStamp('2026-02-30T12:00'), false);
});

test('nowInShop uses Amsterdam time', () => {
  // 23:30 UTC on 1 July is already 01:30 the next day in Amsterdam (CEST).
  assert.deepEqual(nowInShop(new Date('2026-07-01T23:30:00Z')), { date: '2026-07-02', time: '01:30' });
});
