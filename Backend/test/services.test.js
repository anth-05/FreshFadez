import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Service from '../src/models/Service.js';
import { startTestServer, stopTestServer, resetDB } from './helpers/testServer.js';

let app;

before(async () => {
  app = await startTestServer();
});

after(stopTestServer);

beforeEach(resetDB);

test('GET /api/services returns only active services, sorted', async () => {
  await Service.create([
    { slug: 'a', name: 'A', category: 'x', duration: 30, price: 10, order: 2, active: true },
    { slug: 'b', name: 'B', category: 'x', duration: 30, price: 10, order: 1, active: true },
    { slug: 'c', name: 'C', category: 'x', duration: 30, price: 10, order: 0, active: false },
  ]);

  const res = await request(app).get('/api/services');

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.map((s) => s.slug),
    ['b', 'a']
  );
});
