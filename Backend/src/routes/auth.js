import { Router } from 'express';
import { ApiError } from '../middleware/errors.js';
import { barberAuth } from '../middleware/barberAuth.js';
import { createSessionToken, safeEqual, SHORT_SESSION_MS, LONG_SESSION_MS } from '../lib/session.js';

const router = Router();

router.post('/login', (req, res) => {
  const { email, password, remember = false } = req.body ?? {};
  const barberEmail = (process.env.BARBER_EMAIL ?? '').trim().toLowerCase();
  const barberPassword = process.env.BARBER_PASSWORD ?? '';
  if (!barberEmail || !barberPassword) throw new ApiError(500, 'Barber login is not configured');

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new ApiError(400, 'email and password are required');
  }
  const emailOk = safeEqual(email.trim().toLowerCase(), barberEmail);
  const passwordOk = safeEqual(password, barberPassword);
  if (!emailOk || !passwordOk) throw new ApiError(401, 'Invalid email or password');

  const session = createSessionToken(barberEmail, remember ? LONG_SESSION_MS : SHORT_SESSION_MS);
  res.json({ ...session, email: barberEmail });
});

router.get('/me', barberAuth, (req, res) => {
  res.json({ email: req.barber.email });
});

export default router;
