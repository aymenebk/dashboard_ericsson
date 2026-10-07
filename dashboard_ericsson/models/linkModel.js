const mongoose = require('mongoose');

// One document per site + measure point. measurePoint keeps the exact (possibly truncated) text
// from the file; portRef and label are parsed conveniences.
const linkSchema = new mongoose.Schema(
  {
    site: { type: mongoose.Schema.ObjectId, ref: 'Site', required: [true, 'A link belongs to a site'] },
    measurePoint: { type: String, required: [true, 'A link needs a measure point'], trim: true },
    portRef: { type: String, default: null },
    label: { type: String, default: null },
    notInUse: { type: Boolean, default: false },
    entityType: { type: String, default: null },
  },
  { timestamps: true },
);

linkSchema.index({ site: 1, measurePoint: 1 }, { unique: true });

module.exports = mongoose.model('Link', linkSchema);