// Wilaya block of the dashboard and the wilaya list, read from a REAL database after real uploads.
// Own database (DATABASE_TEST + "-wilayas"), emptied after each test and dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { request, loginAsAdmin } = require('./helpers/auth');
const app = require('../app');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Measurement = require('../models/measurementModel');
const { readImportFile } = require('../utils/excelReader');
const { computeMetrics } = require('../utils/calc/saturation');
const { WILAYAS } = require('../config/wilayas');
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, rowInBin, failureRow } = require('./helpers/xlsx');

const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
const MODELS = [Site, Link, Import, ImportIssue, Measurement];
const CRIT = 17; // P95 89.75
const MED = 12; // P95 64.75

const upload = (buffer, name = 'data.xlsx') => request(app).post('/api/v1/imports').attach('file', buffer, name);
const seed = async (rows) => (await upload(await makeXlsx(rows))).body.data.import.id;
const dash = (query = '') => request(app).get(`/api/v1/dashboard${query}`);

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-wilayas`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all(MODELS.map((M) => M.init()));
    await loginAsAdmin();
});
afterEach(async () => {
  if (mongoose.connection.readyState === 1) await Promise.all(MODELS.map((M) => M.deleteMany({})));
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('GET /api/v1/dashboard: wilaya block (synthetic)', () => {
  test('critical sites per wilaya, with names and the two percentages kept apart', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1' }), // Alger: 2 critical, 1 medium
      rowInBin(CRIT, { NeId: 16002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 16003, MeasurePoint: '1/11/1' }),
      rowInBin(CRIT, { NeId: 31001, MeasurePoint: '1/11/1' }), // Oran: 1 critical, 1 failed
      failureRow({ NeId: 31002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 5001, MeasurePoint: '1/11/1' }), // Batna: medium only
    ]);
    const { wilayas, byCondition } = (await dash()).body.data;
    expect(wilayas.criticalSites).toBe(byCondition.critical.count);
    expect(wilayas.criticalSites).toBe(3);
    expect(wilayas.top).toEqual([
      { wilayaCode: 16, name: 'Alger', total: 3, measured: 3, critical: 2, rate: 0.6667, shareOfCritical: 0.6667 },
      { wilayaCode: 31, name: 'Oran', total: 2, measured: 1, critical: 1, rate: 0.5, shareOfCritical: 0.3333 },
    ]);
    expect(wilayas.unassigned).toEqual({ sites: 0, critical: 0 });
  });

  test('ranked sites carry the wilaya name', async () => {
    await seed([rowInBin(CRIT, { NeId: 15001, MeasurePoint: '1/11/1' })]);
    const [top] = (await dash()).body.data.topSites;
    expect(top).toMatchObject({ neId: 15001, wilayaCode: 15, wilayaName: 'Tizi Ouzou' });
  });

  test('wilayaLimit and its validation', async () => {
    await seed([1, 2, 3].map((n) => rowInBin(CRIT, { NeId: n * 1000 + 1, MeasurePoint: '1/11/1' })));
    expect((await dash('?wilayaLimit=2')).body.data.wilayas.top).toHaveLength(2);
    expect((await dash()).body.data.wilayas.top).toHaveLength(3);
    expect((await dash('?wilayaLimit=0')).statusCode).toBe(400);
    expect((await dash('?wilayaLimit=abc')).statusCode).toBe(400);
  });

  test('a NeId outside the 58 wilayas is imported with a warning and shown with a null name', async () => {
    const res = await upload(await makeXlsx([rowInBin(CRIT, { NeId: 77001, MeasurePoint: '1/11/1' })]));
    expect(res.statusCode).toBe(201);
    const id = res.body.data.import.id;
    const detail = (await request(app).get(`/api/v1/imports/${id}`)).body.data.import;
    expect(detail.issues.byCode).toEqual({ WILAYA_OUT_OF_RANGE: 1 });
    expect((await dash()).body.data.wilayas.top[0]).toMatchObject({ wilayaCode: 77, name: null, critical: 1 });
  });

  test('empty database: no wilaya, no crash', async () => {
    expect((await dash()).body.data.wilayas).toEqual({ criticalSites: 0, top: [], unassigned: { sites: 0, critical: 0 } });
  });
});

describe('GET /api/v1/wilayas', () => {
  test('empty database: empty list', async () => {
    const res = await request(app).get('/api/v1/wilayas');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: 0, data: { wilayas: [], unassignedSites: 0 } });
  });

  test('only wilayas that contain sites, with names, sorted by code; unassigned apart', async () => {
    await seed([
      rowInBin(MED, { NeId: 31001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 16001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 16002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 345, MeasurePoint: '1/11/1' }), // 3 digits: no wilaya code
    ]);
    const res = await request(app).get('/api/v1/wilayas');
    expect(res.body.data.wilayas).toEqual([
      { code: 16, name: 'Alger', sites: 2 },
      { code: 31, name: 'Oran', sites: 1 },
    ]);
    expect(res.body.data.unassignedSites).toBe(1);
  });
});

// Reference computed in a SEPARATE pass over the workbook (not by the server code)
async function referenceByWilaya() {
  const { rows } = await readImportFile(fs.readFileSync(REAL), 'xlsx');
  const bySite = new Map();
  rows.forEach((r) => {
    const m = r.failure === null ? computeMetrics(r.bins) : null;
    const key = `${r.neId}|${r.neType}`;
    if (!bySite.has(key)) bySite.set(key, { code: r.wilayaCode, recs: [] });
    bySite.get(key).recs.push({ t: r.endTime.getTime(), load: m && m.ok ? m.p95 : null });
  });
  const wil = new Map();
  bySite.forEach(({ code, recs }) => {
    const latest = Math.max(...recs.map((x) => x.t));
    const loads = recs.filter((x) => x.t === latest).map((x) => x.load).filter((v) => v !== null);
    const load = loads.length ? Math.max(...loads) : null;
    const w = wil.get(code) || { code, total: 0, measured: 0, critical: 0 };
    w.total += 1;
    if (load !== null) w.measured += 1;
    if (load !== null && load >= 80) w.critical += 1;
    wil.set(code, w);
  });
  return [...wil.values()];
}

(fs.existsSync(REAL) ? describe : describe.skip)('wilayas on the real workbook', () => {
  beforeEach(async () => {
    expect((await upload(fs.readFileSync(REAL), 'congestion_data.xlsx')).statusCode).toBe(201);
  });

  test('top 5 wilayas match the reference (counts, totals, rates, order)', async () => {
    const ref = (await referenceByWilaya()).filter((w) => w.critical > 0)
      .sort((a, b) => b.critical - a.critical || b.critical / b.total - a.critical / a.total || a.code - b.code);
    const { wilayas } = (await dash()).body.data;
    expect(wilayas.top).toHaveLength(5);
    wilayas.top.forEach((w, i) => {
      expect(w).toMatchObject({ wilayaCode: ref[i].code, name: WILAYAS[ref[i].code], total: ref[i].total, measured: ref[i].measured, critical: ref[i].critical });
      expect(w.rate).toBeCloseTo(ref[i].critical / ref[i].total, 4);
    });
  });

  test('the wilaya counts reconcile with the global critical count (69)', async () => {
    const { wilayas, byCondition } = (await dash('?wilayaLimit=58')).body.data;
    expect(wilayas.criticalSites).toBe(69);
    expect(wilayas.criticalSites).toBe(byCondition.critical.count);
    expect(wilayas.top.reduce((a, w) => a + w.critical, 0) + wilayas.unassigned.critical).toBe(69);
    expect(wilayas.unassigned).toEqual({ sites: 0, critical: 0 });
    const shares = wilayas.top.reduce((a, w) => a + w.shareOfCritical, 0);
    expect(shares).toBeGreaterThan(0.99);
    expect(shares).toBeLessThan(1.01);
  });

  test('the wilaya list: 29 wilayas (codes 1 to 29), 1194 sites in total', async () => {
    const { wilayas, unassignedSites } = (await request(app).get('/api/v1/wilayas')).body.data;
    expect(wilayas).toHaveLength(29);
    expect(wilayas[0]).toMatchObject({ code: 1, name: 'Adrar' });
    expect(wilayas[28]).toMatchObject({ code: 29, name: 'Mascara' });
    expect(wilayas.reduce((a, w) => a + w.sites, 0)).toBe(1194);
    expect(unassignedSites).toBe(0);
  });

  test('the file produces no out-of-range wilaya warning', async () => {
    const id = (await request(app).get('/api/v1/imports')).body.data.imports[0].id;
    const { issues } = (await request(app).get(`/api/v1/imports/${id}`)).body.data.import;
    expect(issues.byCode.WILAYA_OUT_OF_RANGE).toBeUndefined();
  });
});