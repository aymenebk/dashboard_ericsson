const mongoose = require('mongoose');

const importIssueSchema = new mongoose.Schema({
  import: { type: mongoose.Schema.ObjectId, ref: 'Import', required: true },
  sourceRow: { type: Number, required: true },
  severity: { type: String, enum: ['error', 'warning'], required: true },
  code: { type: String, required: true },
  message: { type: String, required: true },
});

importIssueSchema.index({ import: 1, severity: 1 });
importIssueSchema.index({ import: 1, sourceRow: 1 });

module.exports = mongoose.model('ImportIssue', importIssueSchema);