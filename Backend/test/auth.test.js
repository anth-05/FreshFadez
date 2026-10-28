import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestServer, stopTestServer } from './helpers/testServer.js';

let app;

before(async () => {
  app = await startTestServer();
});

after(stopTestServer);

test('POST /api/auth/login returns a token for the right credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'Saph@FreshFadez.com ', password: 'test-password' });

  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'saph@freshfadez.com');
  assert.ok(res.body.token);
  assert.ok(res.body.expiresAt);
});

test('POST /api/auth/login rejects a wrong password', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'nope' });
  assert.equal(res.status, 401);
});

test('POST /api/auth/login rejects missing fields', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'saph@freshfadez.com' });
  assert.equal(res.status, 400);
});

test('remember me issues a longer session', async () => {
  const short = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'test-password' });
  const long = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'test-password', remember: true });

  const days = (iso) => (new Date(iso) - Date.now()) / 86400000;
  assert.ok(days(short.body.expiresAt) < 1);
  assert.ok(days(long.body.expiresAt) > 29);
});

test('GET /api/auth/me accepts a valid token', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'test-password' });

  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'saph@freshfadez.com');
});

test('GET /api/auth/me rejects missing or tampered tokens', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'saph@freshfadez.com', password: 'test-password' });
  const [payload, sig] = login.body.token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'saph@freshfadez.com', exp: Date.now() + 1e12 })).toString('base64url');

  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}.${sig}`)).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${payload}.x`)).status, 401);
});
