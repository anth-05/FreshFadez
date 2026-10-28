import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../middleware/errors.js';
import { isClosedOn } from '../config/businessHours.js';
import { isValidDate, slotStatuses } from '../lib/slots.js';
import { SLOT_MINUTES } from '../config/businessHours.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    if (!isValidDate(date)) {
      throw new ApiError(400, 'Query param "date" must be formatted as YYYY-MM-DD');
    }
    // How long the customer's selected services take, so only start times that fit are offered.
    const duration = req.query.duration === undefined ? SLOT_MINUTES : Number(req.query.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
      throw new ApiError(400, 'duration must be a whole number of minutes between 1 and 600');
    }

    if (isClosedOn(date)) {
      return res.json({ date, closed: true, slots: [] });
    }

    const slots = (await slotStatuses(date, { duration })).map((s) => ({ time: s.time, available: s.status === 'free' }));
    res.json({ date, closed: false, slots });
  })
);

export default router;
