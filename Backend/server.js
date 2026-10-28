import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDB } from './src/config/db.js';
import Booking from './src/models/Booking.js';
import { backfillBookingSlots } from './src/lib/slots.js';

const PORT = process.env.PORT || 4000;

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env file)');
  await connectDB(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Indexes must exist before the backfill, so overlapping old bookings are caught, not written.
  await Booking.init();
  const { updated, overlapping } = await backfillBookingSlots();
  if (updated) console.log(`Stored time slots for ${updated} existing booking(s).`);
  for (const b of overlapping) {
    console.warn(`Overlapping booking: ${b.date} ${b.time} ${b.firstName} ${b.lastName} (${b._id}). Reschedule it in the portal.`);
  }

  const app = createApp();
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
