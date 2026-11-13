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
    // Optional only for appointments the barber plans in; the public booking route requires it.
    email: { type: String, trim: true, lowercase: true, default: '', maxlength: 254 },
    phone: { type: String, required: true, trim: true },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
    services: { type: [bookedServiceSchema], required: true, validate: (v) => v.length > 0 },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    time: { type: String, required: true }, // 'HH:mm'
    totalPrice: { type: Number, required: true },
    totalDuration: { type: Number, required: true }, // what the services take
    // What the appointment takes up in the agenda, and when it ends ('HH:mm'). Online bookings
    // take at least an hour; the barber can shorten or lengthen it.
    length: { type: Number },
    end: { type: String },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
    // Every quarter-hour unit this booking occupies (see coveredSlots in lib/slots.js).
    slots: { type: [String], default: undefined },
    cancelledAt: { type: Date },
    rescheduledFrom: { date: String, time: String },
    source: { type: String, enum: ['online', 'barber'], default: 'online' },
    // When the customer ticked "I agree with the policy & terms" while booking online (proof for
    // e.g. the 24-hour cancellation rule). Not set for appointments the barber plans in.
    policyAcceptedAt: { type: Date },
    // The online reservation fee (Mollie). While it is unpaid the booking already holds its slot;
    // a failed, cancelled or expired payment cancels the booking. The appointment is paid in the shop.
    payment: {
      type: new mongoose.Schema(
        {
          molliePaymentId: { type: String, index: true },
          status: { type: String, enum: ['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'], default: 'open' },
          amount: { type: Number },
          paidAt: { type: Date },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true }
);

// Prevent double-booking the same slot, but let a cancelled booking free it up again.
bookingSchema.index(
  { date: 1, time: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);

// No two confirmed bookings may share any quarter-hour unit on the same day.
bookingSchema.index(
  { date: 1, slots: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed', slots: { $exists: true } } }
);

export default mongoose.model('Booking', bookingSchema);
