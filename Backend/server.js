import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDB } from './src/config/db.js';

const PORT = process.env.PORT || 4000;

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (check your .env file)');
  await connectDB(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const app = createApp();
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
