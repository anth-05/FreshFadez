import { ApiError } from './errors.js';

export function adminAuth(req, res, next) {
  const key = req.get('x-api-key');
  if (!process.env.ADMIN_API_KEY || key !== process.env.ADMIN_API_KEY) {
    throw new ApiError(401, 'Unauthorized');
  }
  next();
}
