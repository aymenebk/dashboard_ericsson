const mongoose = require('mongoose');
const { BIN_COUNT, EXPECTED_TOTAL_SECONDS } = require('../utils/calc/saturation');

const STATUSES = ['OK', 'PM_NOT_REACHABLE', 'PM_INVALID', 'PM_OTHER'];

// One document per accepted row of an import. Immutable raw data + results of the calculation.
// "condition" (good / medium / critical) is NOT stored: it is computed at read time from p95
// and the configurable thresholds, so changing a threshold never needs a migration.
const measurementSchema = new mongoose.Schema({
  import: { type: mongoose.Schema.ObjectId, ref: 'Import', required: true },
  sourceRow: { type: Number, required: true },
  site: { type: mongoose.Schema.ObjectId, ref: 'Site', required: true },
  link: { type: mongoose.Schema.ObjectId, ref: 'Link', required: true },
  endTime: { type: Date, required: [true, 'A measurement needs a date'] },
  status: { type: String, enum: STATUSES, required: true },
  failure: { type: String, default: null },

  // raw fields from the file: unit unknown, never used in a calculation
  avgRaw: { type: Number, default: null },
  maxRaw: { type: Number, default: null },
  minRaw: { type: Number, default: null },

  bins: {
    type: [Number],
    required: true,
    validate: {
      validator: (a) => a.length === BIN_COUNT && a.every((n) => Number.isInteger(n) && n >= 0),
      message: `bins must hold ${BIN_COUNT} non-negative integers`,
    },
  },

  // results: present only when status is OK
  totalSeconds: { type: Number, default: null },
  tailSeconds: { type: [Number], default: undefined },
  meanUtil: { type: Number, default: null },
  p95: { type: Number, default: null },
});

// Cross-field rules: a measured row carries every result, any other row carries none.
measurementSchema.pre('validate', function checkResults() {
  if (this.status === 'OK') {
    if (!this.tailSeconds || this.tailSeconds.length !== BIN_COUNT) {
      this.invalidate('tailSeconds', `A measured row needs ${BIN_COUNT} tailSeconds`);
    }
    if (this.totalSeconds !== EXPECTED_TOTAL_SECONDS) {
      this.invalidate('totalSeconds', `totalSeconds must be ${EXPECTED_TOTAL_SECONDS}`);
    }
    if (this.p95 === null || this.p95 === undefined) this.invalidate('p95', 'A measured row needs p95');
    if (this.meanUtil === null || this.meanUtil === undefined) this.invalidate('meanUtil', 'A measured row needs meanUtil');
  } else if (this.status) {
    const hasResult = this.p95 != null || this.meanUtil != null || this.totalSeconds != null
      || (this.tailSeconds && this.tailSeconds.length > 0);
    if (hasResult) this.invalidate('status', 'A row without status OK must not carry results');
  }
});

measurementSchema.index({ link: 1, endTime: 1 }, { unique: true }); // one measurement per link per day
measurementSchema.index({ endTime: 1, status: 1 });
measurementSchema.index({ endTime: 1, p95: -1 });
measurementSchema.index({ site: 1, endTime: -1 });
measurementSchema.index({ import: 1, sourceRow: 1 });

module.exports = mongoose.model('Measurement', measurementSchema);