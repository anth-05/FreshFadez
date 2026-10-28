import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import servicesRouter from './routes/services.js';
import availabilityRouter from './routes/availability.js';
import bookingsRouter from './routes/bookings.js';
import authRouter from './routes/auth.js';
import barberRouter from './routes/barber.js';
import { notFound, errorHandler } from './middleware/errors.js';

export function createApp({ rateLimits = true } = {}) {
  const app = express();
  // Behind Render's proxy the client IP arrives in X-Forwarded-For; rate limits need the real IP.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0));

  app.use(helmet());
  app.use(express.json());

  const allowedOrigins = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin: allowedOrigins.length ? allowedOrigins : true,
    })
  );

  const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !rateLimits,
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: () => !rateLimits,
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/services', servicesRouter);
  app.use('/api/availability', availabilityRouter);
  app.use('/api/bookings', bookingLimiter, bookingsRouter);
  app.use('/api/auth/login', loginLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/barber', barberRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
