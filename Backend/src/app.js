import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import servicesRouter from './routes/services.js';
import availabilityRouter from './routes/availability.js';
import bookingsRouter from './routes/bookings.js';
import { notFound, errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();

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
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/services', servicesRouter);
  app.use('/api/availability', availabilityRouter);
  app.use('/api/bookings', bookingLimiter, bookingsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
