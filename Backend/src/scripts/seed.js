import 'dotenv/config';
import { connectDB } from '../config/db.js';
import Service from '../models/Service.js';

// Mirrors the SERVICES array in Frontend/index.html.
const SERVICES = [
  { slug: 'contour', name: 'Contour', category: 'contour', duration: 30, price: 20, order: 1 },
  { slug: 'skin-fade', name: 'Skin fade', category: 'contour', duration: 45, price: 38, order: 2 },
  { slug: 'baard', name: 'Baard', category: 'baard', duration: 20, price: 20, order: 3 },
  { slug: 'knippen-baard', name: 'Knippen + baard', category: 'knippen', duration: 60, price: 50, order: 4 },
  { slug: 'fade-style', name: 'Fade + style', category: 'knippen', duration: 45, price: 35, order: 5 },
  { slug: 'kids', name: 'Kids', category: 'kids', duration: 30, price: 25, order: 6 },
];

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env file)');
  await connectDB(process.env.MONGODB_URI);

  for (const service of SERVICES) {
    await Service.findOneAndUpdate({ slug: service.slug }, service, { upsert: true, new: true });
  }

  console.log(`Seeded ${SERVICES.length} services.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
