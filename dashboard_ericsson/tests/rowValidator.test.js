const fs = require('fs');
const path = require('path');
const { validateRow, validateRows, classifyFailure } = require('../utils/rowValidator');
const { readImportFile } = require('../utils/excelReader');

// Shape produced by excelReader.readImportFile (T3)
const makeRow = (over = {}) => ({
  sourceRow: 2,
  neId: 18870,
  neType: 'AMM 20PB',
  wilayaCode: 18,
  entityType: 'MLTN WAN Eth Bandwidth RX',
  measurePoint: { raw: "1/11/106 'To_2238'", portRef: '1/11/106', label: 'To_2238', notInUse: false },
  endTime: new Date('2026-02-10T00:00:00Z'),
  failure: null,
  avgRaw: 435, maxRaw: 73998, minRaw: 101,
  bins: [50948, 16487, 5770, 2966, 584, 967, 895, 507, 677, 584,
    543, 898, 470, 650, 636, 626, 575, 432, 701, 484],
  issues: [],
  ...over,
});
const zeros = () => new Array(20).fill(0);
const codes = (r) => r.issues.map((i) => i.code);

describe('classifyFailure', () => {
  test.each([
    [null, null],
    ['PM Failure - NE not reachable', 'PM_NOT_REACHABLE'],
    ['PM Failure - NE PM data is invalid', 'PM_INVALID'],
    ['Something else', 'PM_OTHER'],
  ])('%s -> %s', (text, expected) => expect(classifyFailure(text)).toBe(expected));
});

describe('validateRow', () => {
  test('valid row: accepted, status OK, metrics computed, no issue', () => {
    const r = validateRow(makeRow());
    expect(r.outcome).toBe('accepted');
    expect(r.status).toBe('OK');
    expect(r.issues).toEqual([]);
    expect(r.metrics.totalSeconds).toBe(86400);
    expect(r.metrics.p95).toBeCloseTo(62.7021, 3);
    expect(r.metrics.s80 * 100).toBeCloseTo(2.537, 3);
  });

  test('failure row with zero bins: accepted, no metrics, no issue', () => {
    const r = validateRow(makeRow({ failure: 'PM Failure - NE not reachable', bins: zeros(), avgRaw: 0, minRaw: 0, maxRaw: 54 }));
    expect(r.outcome).toBe('accepted');
    expect(r.status).toBe('PM_NOT_REACHABLE');
    expect(r.metrics).toBeNull();
    expect(r.issues).toEqual([]); // Max > 0 on a failure row is ignored, not reported
  });

  test('invalid-data failure maps to PM_INVALID', () => {
    expect(validateRow(makeRow({ failure: 'PM Failure - NE PM data is invalid', bins: zeros() })).status).toBe('PM_INVALID');
  });

  test('failure with non-zero bins: still a failure (no metrics), with a warning', () => {
    const r = validateRow(makeRow({ failure: 'PM Failure - NE not reachable' }));
    expect(r.outcome).toBe('accepted');
    expect(r.status).toBe('PM_NOT_REACHABLE');
    expect(r.metrics).toBeNull();
    expect(codes(r)).toEqual(['FAILURE_WITH_DATA']);
  });

  test('unknown failure text: PM_OTHER with a warning', () => {
    const r = validateRow(makeRow({ failure: 'Disk on fire', bins: zeros() }));
    expect(r.status).toBe('PM_OTHER');
    expect(codes(r)).toEqual(['UNKNOWN_FAILURE']);
  });

  test('no failure but bins do not sum to 86400: rejected', () => {
    const bins = makeRow().bins; bins[0] += 1;
    const r = validateRow(makeRow({ bins }));
    expect(r.outcome).toBe('rejected');
    expect(codes(r)).toEqual(['BINS_SUM_MISMATCH']);
    expect(r.metrics).toBeNull();
  });

  test('no failure and all-zero bins: rejected, never treated as 0 % load', () => {
    const r = validateRow(makeRow({ bins: zeros() }));
    expect(r.outcome).toBe('rejected');
    expect(codes(r)).toEqual(['BINS_ALL_ZERO']);
  });

  test('negative bin: rejected', () => {
    const bins = makeRow().bins; bins[3] = -5;
    expect(codes(validateRow(makeRow({ bins })))).toEqual(['BINS_NEGATIVE']);
  });

  test('parsing issues from the reader make the row rejected', () => {
    const r = validateRow(makeRow({ neId: null, issues: [{ code: 'INVALID_NEID', message: 'NeId is not an integer' }] }));
    expect(r.outcome).toBe('rejected');
    expect(codes(r)).toEqual(['INVALID_NEID']);
  });

  test('NeId with fewer than 4 digits: accepted with a WILAYA_UNKNOWN warning', () => {
    const r = validateRow(makeRow({ neId: 345, wilayaCode: null }));
    expect(r.outcome).toBe('accepted');
    expect(codes(r)).toEqual(['WILAYA_UNKNOWN']);
  });

  test('EndTime not at midnight: warning', () => {
    const r = validateRow(makeRow({ endTime: new Date('2026-02-10T03:00:00Z') }));
    expect(r.outcome).toBe('accepted');
    expect(codes(r)).toEqual(['ENDTIME_NOT_MIDNIGHT']);
  });

  test('Min <= Avg <= Max broken on a measured row: warning', () => {
    const r = validateRow(makeRow({ avgRaw: 999999 }));
    expect(r.outcome).toBe('accepted');
    expect(codes(r)).toEqual(['AVG_MAX_MIN_ORDER']);
  });
});

describe('validateRows (rules across rows)', () => {
  test('duplicate site + measure point + day: the second one is rejected', () => {
    const { results, summary } = validateRows([makeRow({ sourceRow: 2 }), makeRow({ sourceRow: 3 })]);
    expect(results[0].outcome).toBe('accepted');
    expect(results[1].outcome).toBe('rejected');
    expect(codes(results[1])).toEqual(['DUPLICATE_IN_FILE']);
    expect(results[1].issues[0].message).toContain('row 2');
    expect(summary).toMatchObject({ total: 2, accepted: 1, rejected: 1, valid: 1 });
  });

  test('same link on another day is not a duplicate', () => {
    const { summary } = validateRows([
      makeRow({ sourceRow: 2 }),
      makeRow({ sourceRow: 3, endTime: new Date('2026-02-11T00:00:00Z') }),
    ]);
    expect(summary.rejected).toBe(0);
  });

  test('same NeId with two NeType values: warning on both rows', () => {
    const { results, summary } = validateRows([
      makeRow({ sourceRow: 2 }),
      makeRow({ sourceRow: 3, neType: 'SIU 02', measurePoint: { raw: '1/11/104', portRef: '1/11/104', label: null, notInUse: false } }),
    ]);
    expect(results.map(codes)).toEqual([['NEID_MULTIPLE_NETYPE'], ['NEID_MULTIPLE_NETYPE']]);
    expect(summary.withWarnings).toBe(2);
    expect(summary.accepted).toBe(2);
  });

  test('summary counts statuses and issue codes', () => {
    const { summary } = validateRows([
      makeRow({ sourceRow: 2 }),
      makeRow({ sourceRow: 3, neId: 21952, failure: 'PM Failure - NE PM data is invalid', bins: zeros(),
        measurePoint: { raw: '1/11/104', portRef: '1/11/104', label: null, notInUse: false } }),
      makeRow({ sourceRow: 4, neId: 5000, bins: zeros(),
        measurePoint: { raw: '1/11/105', portRef: '1/11/105', label: null, notInUse: false } }),
    ]);
    expect(summary).toMatchObject({
      total: 3, accepted: 2, rejected: 1, valid: 1, failed: 1,
      byStatus: { OK: 1, PM_INVALID: 1 },
      issueCounts: { BINS_ALL_ZERO: 1 },
    });
  });
});

// Real workbook (dev-data/, never committed). Skipped when absent.
const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
(fs.existsSync(REAL) ? describe : describe.skip)('real workbook through reader + validator', () => {
  let out;
  beforeAll(async () => {
    const { rows } = await readImportFile(fs.readFileSync(REAL), 'xlsx');
    out = validateRows(rows);
  });

  test('1200 accepted, 0 rejected: 862 measured, 338 failures', () => {
    expect(out.summary).toMatchObject({ total: 1200, accepted: 1200, rejected: 0, valid: 862, failed: 338 });
    expect(out.summary.byStatus).toEqual({ OK: 862, PM_NOT_REACHABLE: 184, PM_INVALID: 154 });
  });
  test('every measured row has metrics, no failure row has any', () => {
    expect(out.results.filter((r) => r.status === 'OK').every((r) => r.metrics && r.metrics.ok)).toBe(true);
    expect(out.results.filter((r) => r.status !== 'OK').every((r) => r.metrics === null)).toBe(true);
  });
  test('no duplicate, no error; warnings only for NeId with two NeType', () => {
    expect(out.summary.issueCounts.DUPLICATE_IN_FILE).toBeUndefined();
    const codesSeen = Object.keys(out.summary.issueCounts);
    expect(codesSeen).toEqual(['NEID_MULTIPLE_NETYPE']);
  });
  test('P95 of the 862 measured rows stays between 54 and 87', () => {
    const p = out.results.filter((r) => r.status === 'OK').map((r) => r.metrics.p95);
    expect(Math.min(...p)).toBeGreaterThan(54);
    expect(Math.max(...p)).toBeLessThan(87);
    expect(p.filter((x) => x >= 80)).toHaveLength(70);
  });
});