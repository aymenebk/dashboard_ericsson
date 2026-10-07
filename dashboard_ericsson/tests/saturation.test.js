const {
  validateBins, computeTails, saturationRatio, meanUtilApprox, percentileUtil, computeMetrics,
} = require('../utils/calc/saturation');

// Real row from the workbook: NeId 18870, AMM 20PB, 1/11/106, 10/02/2026
const ROW_18870 = [
  50948, 16487, 5770, 2966, 584, 967, 895, 507, 677, 584,
  543, 898, 470, 650, 636, 626, 575, 432, 701, 484,
];

describe('validateBins', () => {
  test('accepts the real row (sum = 86400)', () => {
    expect(validateBins(ROW_18870)).toEqual({ valid: true, total: 86400 });
  });
  test('rejects all-zero row (PM failure)', () => {
    expect(validateBins(new Array(20).fill(0)).reason).toBe('BINS_ALL_ZERO');
  });
  test('rejects wrong length', () => {
    expect(validateBins([1, 2, 3]).reason).toBe('BINS_LENGTH');
    expect(validateBins(null).reason).toBe('BINS_LENGTH');
  });
  test('rejects negative and non-integer values', () => {
    const neg = [...ROW_18870]; neg[0] = -1;
    const dec = [...ROW_18870]; dec[0] = 1.5;
    expect(validateBins(neg).reason).toBe('BINS_NEGATIVE');
    expect(validateBins(dec).reason).toBe('BINS_NOT_INTEGER');
  });
  test('rejects a sum different from 86400', () => {
    const bad = [...ROW_18870]; bad[0] += 1;
    expect(validateBins(bad).reason).toBe('BINS_SUM_MISMATCH');
  });
});

describe('tails and S(theta)', () => {
  const tails = computeTails(ROW_18870);
  test('tail[0] equals the total, tail[19] the last bin', () => {
    expect(tails[0]).toBe(86400);
    expect(tails[19]).toBe(484);
  });
  test('worked example of the spec: S(80) = 2192 s = 2.54 %', () => {
    expect(tails[16]).toBe(2192);
    expect(saturationRatio(tails, 86400, 80) * 100).toBeCloseTo(2.5370, 3);
  });
  test('S(90) = 1185 s = 1.37 %, S(70) = 3454 s = 4.00 %', () => {
    expect(tails[18]).toBe(1185);
    expect(saturationRatio(tails, 86400, 90) * 100).toBeCloseTo(1.3715, 3);
    expect(tails[14]).toBe(3454);
    expect(saturationRatio(tails, 86400, 70) * 100).toBeCloseTo(3.9977, 3);
  });
  test('invalid theta throws', () => {
    for (const t of [0, 100, 82, -5, 80.5, '80']) {
      expect(() => saturationRatio(tails, 86400, t)).toThrow(RangeError);
    }
  });
});

describe('meanUtilApprox', () => {
  test('all time in one bin gives that bin midpoint', () => {
    const b = new Array(20).fill(0); b[10] = 86400;
    expect(meanUtilApprox(b, 86400)).toBeCloseTo(52.5, 6);
  });
  test('real row stays within the bin-width bounds', () => {
    const m = meanUtilApprox(ROW_18870, 86400);
    const low = ROW_18870.reduce((s, t, i) => s + 5 * i * t, 0) / 86400;
    expect(m).toBeGreaterThanOrEqual(low);
    expect(m).toBeLessThanOrEqual(low + 5);
  });
});

describe('percentileUtil', () => {
  test('all time in the top bin: P95 is inside 95-100', () => {
    const b = new Array(20).fill(0); b[19] = 86400;
    const p = percentileUtil(b, 86400, 95);
    expect(p).toBeGreaterThanOrEqual(95);
    expect(p).toBeLessThanOrEqual(100);
  });
  test('all time in the lowest bin: P95 is inside 0-5', () => {
    const b = new Array(20).fill(0); b[0] = 86400;
    expect(percentileUtil(b, 86400, 95)).toBeLessThanOrEqual(5);
  });
  test('uniform distribution: P95 is 95', () => {
    const b = new Array(20).fill(4320);
    expect(percentileUtil(b, 86400, 95)).toBeCloseTo(95, 6);
  });
  test('real row: P95 = 62.70 (hand check below)', () => {
    // Cumulative from the top: 3454 s at bin 70-75, 4104 s at 65-70, 4574 s at 60-65.
    // The target is 5 % of 86400 = 4320 s, inside bin 60-65:
    // 60 + 5 * (4574 - 4320) / 470 = 62.7021...
    expect(percentileUtil(ROW_18870, 86400, 95)).toBeCloseTo(62.7021, 3);
  });
  test('P95 >= 80 exactly when S(80) >= 5 %', () => {
    const b = new Array(20).fill(0); b[0] = 80000; b[17] = 6400;
    const tails = computeTails(b);
    expect(saturationRatio(tails, 86400, 80)).toBeGreaterThan(0.05);
    expect(percentileUtil(b, 86400, 95)).toBeGreaterThanOrEqual(80);
  });
  test('invalid p throws', () => {
    expect(() => percentileUtil(ROW_18870, 86400, 0)).toThrow(RangeError);
    expect(() => percentileUtil(ROW_18870, 86400, 100)).toThrow(RangeError);
  });
});

describe('computeMetrics', () => {
  test('valid row returns all metrics', () => {
    const r = computeMetrics(ROW_18870);
    expect(r.ok).toBe(true);
    expect(r.totalSeconds).toBe(86400);
    expect(r.tailSeconds).toHaveLength(20);
    expect(r.s80 * 100).toBeCloseTo(2.537, 3);
  });
  test('failure row returns ok:false with a reason, never zeros', () => {
    const r = computeMetrics(new Array(20).fill(0));
    expect(r).toEqual({ ok: false, reason: 'BINS_ALL_ZERO' });
  });
});