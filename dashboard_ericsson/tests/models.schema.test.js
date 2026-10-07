// Schema tests: no database needed (validation rules and index definitions only).
const mongoose = require('mongoose');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Measurement = require('../models/measurementModel');
const { computeMetrics } = require('../utils/calc/saturation');

const BINS_18870 = [50948, 16487, 5770, 2966, 584, 967, 895, 507, 677, 584,
  543, 898, 470, 650, 636, 626, 575, 432, 701, 484];
const id = () => new mongoose.Types.ObjectId();

// Names of the invalid fields ([] when valid). validate() also runs the pre('validate') rules.
const errorPaths = async (doc) => {
  try { await doc.validate(); return []; } catch (e) { return Object.keys(e.errors); }
};

const okMeasurement = (over = {}) => {
  const m = computeMetrics(BINS_18870);
  return new Measurement({
    import: id(), sourceRow: 2, site: id(), link: id(), endTime: new Date('2026-02-10T00:00:00Z'),
    status: 'OK', failure: null, avgRaw: 435, maxRaw: 73998, minRaw: 101, bins: BINS_18870,
    totalSeconds: m.totalSeconds, tailSeconds: m.tailSeconds, meanUtil: m.meanUtil, p95: m.p95,
    ...over,
  });
};
const failureMeasurement = (over = {}) => new Measurement({
  import: id(), sourceRow: 3, site: id(), link: id(), endTime: new Date('2026-02-10T00:00:00Z'),
  status: 'PM_INVALID', failure: 'PM Failure - NE PM data is invalid', bins: new Array(20).fill(0),
  ...over,
});

describe('Site', () => {
  test('valid site', async () => {
    expect(await errorPaths(new Site({ neId: 18870, neType: 'AMM 20PB', wilayaCode: 18 }))).toEqual([]);
  });
  test('NeId and NeType are required, NeId must be an integer', async () => {
    expect(await errorPaths(new Site({}))).toEqual(expect.arrayContaining(['neId', 'neType']));
    expect(await errorPaths(new Site({ neId: 12.5, neType: 'X' }))).toEqual(['neId']);
  });
  test('wilaya code defaults to null', () => {
    expect(new Site({ neId: 1, neType: 'X' }).wilayaCode).toBeNull();
  });
});

describe('Link', () => {
  test('valid link', async () => {
    expect(await errorPaths(new Link({ site: id(), measurePoint: '1/11/104' }))).toEqual([]);
  });
  test('site and measurePoint are required', async () => {
    expect(await errorPaths(new Link({}))).toEqual(expect.arrayContaining(['site', 'measurePoint']));
  });
});

describe('Import', () => {
  const valid = { fileName: 'congestion_data.xlsx', fileType: 'xlsx', fileSize: 1000, sha256: 'a'.repeat(64) };
  test('valid import defaults to processing with zero counts', async () => {
    const i = new Import(valid);
    expect(await errorPaths(i)).toEqual([]);
    expect(i.status).toBe('processing');
    expect(i.counts.valid).toBe(0);
    expect(i.sitesCount).toBe(0);
  });
  test('"failed" is not a stored status (failed imports are deleted)', async () => {
    expect(await errorPaths(new Import({ ...valid, status: 'failed' }))).toEqual(['status']);
  });
  test('bad sha256, bad file type', async () => {
    expect(await errorPaths(new Import({ ...valid, sha256: 'xyz' }))).toEqual(['sha256']);
    expect(await errorPaths(new Import({ ...valid, fileType: 'pdf' }))).toEqual(['fileType']);
  });
});

describe('ImportIssue', () => {
  test('severity must be error or warning', async () => {
    const base = { import: id(), sourceRow: 5, code: 'X', message: 'm' };
    expect(await errorPaths(new ImportIssue({ ...base, severity: 'warning' }))).toEqual([]);
    expect(await errorPaths(new ImportIssue({ ...base, severity: 'info' }))).toEqual(['severity']);
  });
});

describe('Measurement', () => {
  test('measured row with all results is valid', async () => {
    expect(await errorPaths(okMeasurement())).toEqual([]);
  });
  test('failure row without results is valid and carries none', async () => {
    const m = failureMeasurement();
    expect(await errorPaths(m)).toEqual([]);
    expect(m.p95).toBeNull();
    expect(m.totalSeconds).toBeNull();
    expect(m.tailSeconds).toBeUndefined();
  });
  test('measured row missing its results is invalid', async () => {
    expect(await errorPaths(okMeasurement({ tailSeconds: undefined }))).toContain('tailSeconds');
    expect(await errorPaths(okMeasurement({ p95: null }))).toContain('p95');
    expect(await errorPaths(okMeasurement({ meanUtil: null }))).toContain('meanUtil');
    expect(await errorPaths(okMeasurement({ totalSeconds: 86399 }))).toContain('totalSeconds');
  });
  test('failure row carrying results is invalid (0 % must never be invented)', async () => {
    expect(await errorPaths(failureMeasurement({ p95: 0 }))).toContain('status');
    expect(await errorPaths(failureMeasurement({ totalSeconds: 0 }))).toContain('status');
    expect(await errorPaths(failureMeasurement({ tailSeconds: [1, 2] }))).toContain('status');
  });
  test('bins must be 20 non-negative integers', async () => {
    expect(await errorPaths(okMeasurement({ bins: BINS_18870.slice(0, 19) }))).toContain('bins');
    expect(await errorPaths(okMeasurement({ bins: [-1, ...BINS_18870.slice(1)] }))).toContain('bins');
    expect(await errorPaths(okMeasurement({ bins: [1.5, ...BINS_18870.slice(1)] }))).toContain('bins');
  });
  test('unknown status and missing date are invalid', async () => {
    expect(await errorPaths(okMeasurement({ status: 'BROKEN' }))).toContain('status');
    expect(await errorPaths(okMeasurement({ endTime: undefined }))).toContain('endTime');
  });
});

describe('Index definitions', () => {
  const find = (model, spec) => model.schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify(spec));

  test('Site: unique (neId, neType)', () => {
    expect(find(Site, { neId: 1, neType: 1 })[1].unique).toBe(true);
  });
  test('Link: unique (site, measurePoint)', () => {
    expect(find(Link, { site: 1, measurePoint: 1 })[1].unique).toBe(true);
  });
  test('Import: unique sha256', () => {
    expect(find(Import, { sha256: 1 })[1].unique).toBe(true);
  });
  test('Measurement: unique (link, endTime) plus query indexes', () => {
    expect(find(Measurement, { link: 1, endTime: 1 })[1].unique).toBe(true);
    expect(find(Measurement, { endTime: 1, status: 1 })).toBeDefined();
    expect(find(Measurement, { endTime: 1, p95: -1 })).toBeDefined();
    expect(find(Measurement, { site: 1, endTime: -1 })).toBeDefined();
  });
});