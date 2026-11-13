import 'dotenv/config';
import { connectDB } from '../config/db.js';
import Service from '../models/Service.js';

// The services and prices from the shop's Salonized page. Category slugs match cat_* in Frontend/index.html.
const SERVICES = [
  { slug: 'contour', name: 'Contour', category: 'contour', duration: 60, price: 12.5, order: 1 },
  { slug: 'baard', name: 'Baard trimmen', category: 'baard', duration: 30, price: 12.5, order: 2 },
  { slug: 'knippen-baard', name: 'Knippen (inclusief baard)', category: 'knippen', duration: 60, price: 25, order: 3 },
  { slug: 'kids', name: 'Knipbeurt kids (tot 11 jaar)', category: 'kids', duration: 60, price: 20, order: 4 },
];

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env file)');
  await connectDB(process.env.MONGODB_URI);

  for (const service of SERVICES) {
    await Service.findOneAndUpdate({ slug: service.slug }, { ...service, active: true }, { upsert: true, new: true });
  }
  // Services no longer offered stay in the database (old bookings refer to them) but can't be booked.
  const { modifiedCount } = await Service.updateMany({ slug: { $nin: SERVICES.map((s) => s.slug) } }, { active: false });

  console.log(`Seeded ${SERVICES.length} services${modifiedCount ? `, switched off ${modifiedCount} old one(s)` : ''}.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
