import { Router } from 'express';
import Service from '../models/Service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await Service.find({ active: true }).sort({ order: 1, category: 1 }).lean();
    res.json(services);
  })
);

export default router;
