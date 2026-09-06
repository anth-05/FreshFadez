import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  duration: { type: Number, required: true, min: 5 }, // minutes
  price: { type: Number, required: true, min: 0 }, // euros
  order: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});

export default mongoose.model('Service', serviceSchema);
