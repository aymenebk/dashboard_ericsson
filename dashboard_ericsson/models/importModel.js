const mongoose = require('mongoose');

// One document per uploaded file. A failed import is deleted (never shown in the history).
// "processing" and "reverting" are temporary, hidden states; only "successful" imports are visible.
const importSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: [true, 'An import needs a file name'], trim: true },
    fileType: { type: String, enum: ['xlsx', 'csv'], required: true },
    fileSize: { type: Number, required: true, min: 0 },
    sha256: {
      type: String,
      required: true,
      lowercase: true,
      match: [/^[a-f0-9]{64}$/, 'sha256 must be 64 hexadecimal characters'],
    },
    status: { type: String, enum: ['processing', 'successful', 'reverting'], default: 'processing' },
    counts: {
      rowsTotal: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 }, // rows already imported earlier (same link and day)
      withWarnings: { type: Number, default: 0 },
    },
    sitesCount: { type: Number, default: 0 },
    periodFrom: { type: Date, default: null },
    periodTo: { type: Date, default: null },
    // Only while "reverting": the links and sites this import touched, written BEFORE anything is deleted,
    // so that an interrupted revert can be resumed and still find its orphans. Never returned by a query.
    revertLinks: { type: [mongoose.Schema.ObjectId], select: false, default: undefined },
    revertSites: { type: [mongoose.Schema.ObjectId], select: false, default: undefined },
  },
  { timestamps: true }, // createdAt = "imported on" in the history screen
);

importSchema.index({ sha256: 1 }, { unique: true }); // the same file cannot be imported twice
importSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Import', importSchema);