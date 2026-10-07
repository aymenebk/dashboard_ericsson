const mongoose = require('mongoose');

// One document per (neId, neType). The wilaya code is derived from the NeId at import time;
// the wilaya NAME comes from a reference table (T9).
const siteSchema = new mongoose.Schema(
  {
    neId: {
      type: Number,
      required: [true, 'A site needs a NeId'],
      validate: { validator: Number.isInteger, message: 'NeId must be an integer' },
    },
    neType: { type: String, required: [true, 'A site needs a NeType'], trim: true },
    wilayaCode: { type: Number, default: null, min: 1 },
  },
  { timestamps: true },
);

siteSchema.index({ neId: 1, neType: 1 }, { unique: true });
siteSchema.index({ wilayaCode: 1 });

module.exports = mongoose.model('Site', siteSchema);