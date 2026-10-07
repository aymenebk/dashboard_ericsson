// Pure calculation module: no Express, no Mongoose.
// A "bin" i covers utilization [5i, 5i+5) percent, i = 0..19.

const BIN_COUNT = 20;
const BIN_WIDTH = 5;
const EXPECTED_TOTAL_SECONDS = 86400;

function validateBins(bins, expectedTotal = EXPECTED_TOTAL_SECONDS) {
  if (!Array.isArray(bins) || bins.length !== BIN_COUNT) {
    return { valid: false, reason: 'BINS_LENGTH' };
  }
  for (const b of bins) {
    if (!Number.isInteger(b)) return { valid: false, reason: 'BINS_NOT_INTEGER' };
    if (b < 0) return { valid: false, reason: 'BINS_NEGATIVE' };
  }
  const total = bins.reduce((a, b) => a + b, 0);
  if (total === 0) return { valid: false, reason: 'BINS_ALL_ZERO' };
  if (total !== expectedTotal) return { valid: false, reason: 'BINS_SUM_MISMATCH' };
  return { valid: true, total };
}

// tail[k] = seconds spent at or above 5k percent
function computeTails(bins) {
  const tails = new Array(BIN_COUNT).fill(0);
  let running = 0;
  for (let i = BIN_COUNT - 1; i >= 0; i--) {
    running += bins[i];
    tails[i] = running;
  }
  return tails;
}

// S(theta): share of the period at or above theta percent (0..1)
function saturationRatio(tails, total, theta) {
  if (!Number.isInteger(theta) || theta < 5 || theta > 95 || theta % BIN_WIDTH !== 0) {
    throw new RangeError('theta must be a multiple of 5 between 5 and 95');
  }
  return tails[theta / BIN_WIDTH] / total;
}

// Approximate mean utilization (percent), using bin midpoints
function meanUtilApprox(bins, total) {
  let sum = 0;
  for (let i = 0; i < BIN_COUNT; i++) sum += (i * BIN_WIDTH + BIN_WIDTH / 2) * bins[i];
  return sum / total;
}

// Percentile p (e.g. 95): utilization level (percent) that is exceeded
// only (100-p)% of the time. Linear interpolation inside the bin.
function percentileUtil(bins, total, p = 95) {
  if (!(p > 0 && p < 100)) throw new RangeError('p must be between 0 and 100 (exclusive)');
  const target = ((100 - p) / 100) * total; // seconds allowed above the level
  let cumulative = 0;
  for (let i = BIN_COUNT - 1; i >= 0; i--) {
    const next = cumulative + bins[i];
    if (next >= target) {
      const fractionInBin = bins[i] === 0 ? 0 : (next - target) / bins[i];
      return i * BIN_WIDTH + fractionInBin * BIN_WIDTH;
    }
    cumulative = next;
  }
  return 0;
}

// One call for the import pipeline. Returns ok:false + reason if invalid.
function computeMetrics(bins, opts = {}) {
  const check = validateBins(bins, opts.expectedTotal);
  if (!check.valid) return { ok: false, reason: check.reason };
  const total = check.total;
  const tailSeconds = computeTails(bins);
  return {
    ok: true,
    totalSeconds: total,
    tailSeconds,
    meanUtil: meanUtilApprox(bins, total),
    p95: percentileUtil(bins, total, 95),
    s80: saturationRatio(tailSeconds, total, 80),
  };
}

module.exports = {
  BIN_COUNT, BIN_WIDTH, EXPECTED_TOTAL_SECONDS,
  validateBins, computeTails, saturationRatio, meanUtilApprox, percentileUtil, computeMetrics,
};