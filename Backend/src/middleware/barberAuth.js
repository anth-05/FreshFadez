import { ApiError } from './errors.js';
import { verifySessionToken } from '../lib/session.js';

export function barberAuth(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = verifySessionToken(token);
  if (!session) throw new ApiError(401, 'Unauthorized');
  req.barber = { email: session.sub };
  next();
}
