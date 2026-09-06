import mongoose from 'mongoose';

const bookedServiceSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    duration: { type: Number, required: true },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: '' },
    saveInfo: { type: Boolean, default: true },
    newsletter: { type: Boolean, default: false },
    services: { type: [bookedServiceSchema], required: true, validate: (v) => v.length > 0 },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    totalPrice: { type: Number, required: true },
    totalDuration: { type: Number, required: true },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  },
  { timestamps: true }
);

// Prevent double-booking the same slot, but let a cancelled booking free it up again.
bookingSchema.index(
  { date: 1, time: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);

export default mongoose.model('Booking', bookingSchema);
