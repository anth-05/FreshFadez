import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../../src/app.js';

let mongod;

export async function startTestServer() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  process.env.ADMIN_API_KEY = 'test-admin-key';
  return createApp();
}

export async function stopTestServer() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export async function resetDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
