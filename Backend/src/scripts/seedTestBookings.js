import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Booking from '../models/Booking.js';
import Service from '../models/Service.js';
import { isClosedOn, nowInShop, addDays } from '../config/businessHours.js';
import { coveredSlots, slotStatuses } from '../lib/slots.js';

// Test bookings are recognisable by this email domain, so --remove only ever deletes these.
const TEST_EMAIL_DOMAIN = 'test.freshfadez.nl';
const PEOPLE = [
  ['Ali', 'Yilmaz', '06 1234 5678'],
  ['Ben', 'de Vries', '0687654321'],
  ['Cem', 'Kaya', '06-2345 6789'],
  ['Daan', 'Bakker', '0611122233'],
  ['Emre', 'Demir', '06 3456 7890'],
  ['Finn', 'Jansen', '0644455566'],
  ['Gio', 'Rossi', '06 9876 5432'],
  ['Hamza', 'El Amrani', '0677788899'],
  ['Ivo', 'Smit', '06 5555 1234'],
  ['Jayden', 'Visser', '0612121212'],
];
const PER_DAY = 4;

async function add(count) {
  const services = await Service.find({ active: true }).sort({ order: 1 }).lean();
  if (!services.length) throw new Error('No services found. Run "npm run seed" first.');

  const created = [];
  for (let offset = 0; created.length < count && offset < 30; offset++) {
    const date = addDays(nowInShop().date, offset);
    if (isClosedOn(date)) continue;
    for (let n = 0; n < PER_DAY && created.length < count; n++) {
      const [firstName, lastName, phone] = PEOPLE[created.length % PEOPLE.length];
      const picked = services.slice(created.length % services.length, (created.length % services.length) + 1 + (created.length % 2));
      const duration = picked.reduce((sum, s) => sum + s.duration, 0);
      const slot = (await slotStatuses(date, { duration })).find((s) => s.status === 'free');
      if (!slot) break;
      const { time } = slot;
      const booking = await Booking.create({
        firstName,
        lastName,
        phone,
        email: `${firstName.toLowerCase()}.${created.length + 1}@${TEST_EMAIL_DOMAIN}`,
        notes: created.length % 3 === 0 ? 'TEST: graag kort aan de zijkant' : '',
        services: picked.map(({ slug, name, price, duration }) => ({ slug, name, price, duration })),
        date,
        time,
        slots: coveredSlots(date, time, duration),
        totalPrice: picked.reduce((sum, s) => sum + s.price, 0),
        totalDuration: duration,
      });
      created.push(booking);
    }
  }
  for (const b of created) console.log(`  ${b.date} ${b.time}  ${b.firstName} ${b.lastName}`);
  console.log(`Added ${created.length} test bookings.`);
}

async function remove() {
  const { deletedCount } = await Booking.deleteMany({ email: new RegExp(`@${TEST_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`) });
  console.log(`Removed ${deletedCount} test bookings.`);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env file)');
  await connectDB(process.env.MONGODB_URI);
  if (process.argv.includes('--remove')) await remove();
  else await add(Number(process.argv[2]) || 10);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
