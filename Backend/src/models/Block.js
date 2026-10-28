import mongoose from 'mongoose';

// A period the barber is unavailable. start/end are shop-local 'YYYY-MM-DDTHH:mm' strings,
// so they compare correctly as plain strings. end is exclusive and may use '24:00'.
const blockSchema = new mongoose.Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    reason: { type: String, trim: true, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

blockSchema.index({ end: 1, start: 1 });

export default mongoose.model('Block', blockSchema);
