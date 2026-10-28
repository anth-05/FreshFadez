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
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    saveInfo: { type: Boolean, default: true },
    newsletter: { type: Boolean, default: false },
    services: { type: [bookedServiceSchema], required: true, validate: (v) => v.length > 0 },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    totalPrice: { type: Number, required: true },
    totalDuration: { type: Number, required: true },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
    // Every time slot this booking occupies (see coveredSlots in lib/slots.js).
    slots: { type: [String], default: undefined },
    cancelledAt: { type: Date },
    rescheduledFrom: { date: String, time: String },
  },
  { timestamps: true }
);

// Prevent double-booking the same slot, but let a cancelled booking free it up again.
bookingSchema.index(
  { date: 1, time: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);

// Long bookings span several slots: no two confirmed bookings may share any slot on the same day.
bookingSchema.index(
  { date: 1, slots: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed', slots: { $exists: true } } }
);

export default mongoose.model('Booking', bookingSchema);
