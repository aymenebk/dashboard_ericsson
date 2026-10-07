// Dashboard computed from a REAL database after real uploads.
// Own database (DATABASE_TEST + "-dashboard"), emptied after each test and dropped at the end.
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
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, rowInBin, failureRow } = require('./helpers/xlsx');

const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
const MODELS = [Site, Link, Import, ImportIssue, Measurement];
const D10 = '10/02/2026 00:00:00';
const D11 = '11/02/2026 00:00:00';
const D12 = '12/02/2026 00:00:00';
// P95 produced by rowInBin: 5 * bin + 4.75
const CRIT = 17; // 89.75
const MED = 12; // 64.75
const GOOD = 0; // 4.75

const upload = (buffer, name = 'data.xlsx') => request(app).post('/api/v1/imports').attach('file', buffer, name);
const seed = async (rows, name) => (await upload(await makeXlsx(rows), name)).body.data.import.id;
const dash = (query = '') => request(app).get(`/api/v1/dashboard${query}`);

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-dashboard`;
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

describe('GET /api/v1/dashboard: synthetic data', () => {
  test('empty database: 200, zeros, empty lists', async () => {
    const res = await dash();
    expect(res.statusCode).toBe(200);
    expect(res.body.data.totals).toEqual({ sites: 0, measured: 0, noData: 0 });
    expect(res.body.data.topSites).toEqual([]);
    expect(res.body.data.scope).toEqual({ import: null, asOf: null, latestUpdate: null });
  });

  test('conditions, shares, rankings; the failed site is grey and never ranked', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1' }),
      rowInBin(GOOD, { NeId: 3003, MeasurePoint: '1/11/1' }),
      failureRow({ NeId: 4004, MeasurePoint: '1/11/1' }),
    ]);
    const { data } = (await dash()).body;
    expect(data.thresholds).toEqual({ metric: 'p95', mediumFrom: 50, criticalFrom: 80 });
    expect(data.totals).toEqual({ sites: 4, measured: 3, noData: 1 });
    expect(data.byCondition).toEqual({
      critical: { count: 1, share: 0.25 }, medium: { count: 1, share: 0.25 },
      good: { count: 1, share: 0.25 }, no_data: { count: 1, share: 0.25 },
    });
    expect(data.topSites.map((s) => [s.neId, s.load, s.condition])).toEqual([
      [1001, 89.75, 'critical'], [2002, 64.75, 'medium'], [3003, 4.75, 'good'],
    ]);
    expect(data.bottomSites.map((s) => s.neId)).toEqual([3003, 2002, 1001]);
    expect(data.scope.latestUpdate).toBe('2026-02-10T00:00:00.000Z');
    expect(data.topSites[0]).toMatchObject({ wilayaCode: 1, neType: 'AMM 20PB', lastUpdate: '2026-02-10T00:00:00.000Z' });
  });

  test('a site with two links on its latest day takes its WORST link', async () => {
    await seed([
      rowInBin(GOOD, { NeId: 1001, MeasurePoint: '1/11/1' }),
      rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/2' }),
    ]);
    const { data } = (await dash()).body;
    expect(data.totals.sites).toBe(1);
    expect(data.topSites[0]).toMatchObject({ neId: 1001, load: 89.75, condition: 'critical' });
  });

  test('a failed link next to a measured one does not hide the measured one', async () => {
    await seed([
      failureRow({ NeId: 1001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 1001, MeasurePoint: '1/11/2' }),
    ]);
    expect((await dash()).body.data.topSites[0]).toMatchObject({ neId: 1001, load: 64.75, condition: 'medium' });
  });

  test('the latest day wins; if that day failed the site is grey, not its old value', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: D10 }), // critical on 10, good on 12
      rowInBin(GOOD, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: D12 }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1', EndTime: D10 }), // medium on 10, failure on 12
      failureRow({ NeId: 2002, MeasurePoint: '1/11/1', EndTime: D12 }),
    ]);
    const { data } = (await dash()).body;
    expect(data.totals).toEqual({ sites: 2, measured: 1, noData: 1 });
    expect(data.topSites).toHaveLength(1);
    expect(data.topSites[0]).toMatchObject({ neId: 1001, load: 4.75, condition: 'good', lastUpdate: '2026-02-12T00:00:00.000Z' });
  });

  test('date = state as of that day; sites first seen later are not counted yet', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: D10 }),
      rowInBin(GOOD, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: D12 }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1', EndTime: D12 }), // first seen on the 12th
    ]);
    const asOf11 = (await dash('?date=2026-02-11')).body.data;
    expect(asOf11.totals.sites).toBe(1);
    expect(asOf11.topSites[0]).toMatchObject({ neId: 1001, load: 89.75, condition: 'critical' });
    expect(asOf11.scope.asOf).toBe('2026-02-11');

    const asOf12 = (await dash('?date=2026-02-12')).body.data;
    expect(asOf12.totals.sites).toBe(2);
    expect(asOf12.topSites[0]).toMatchObject({ neId: 2002, load: 64.75 });

    expect((await dash('?date=2026-02-09')).body.data.totals.sites).toBe(0);
  });

  test('import = only the sites measured in that import', async () => {
    const first = await seed([rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: D10 })]);
    const second = await seed([rowInBin(GOOD, { NeId: 2002, MeasurePoint: '1/11/1', EndTime: D11 })]);
    const a = (await dash(`?import=${first}`)).body.data;
    expect(a.totals.sites).toBe(1);
    expect(a.scope.import).toBe(first);
    expect(a.topSites[0].neId).toBe(1001);
    expect((await dash(`?import=${second}`)).body.data.topSites[0].neId).toBe(2002);
    expect((await dash()).body.data.totals.sites).toBe(2);
  });

  test('limit', async () => {
    await seed([1, 2, 3].map((n) => rowInBin(MED, { NeId: 1000 + n, MeasurePoint: `1/11/${n}` })));
    const { data } = (await dash('?limit=2')).body;
    expect(data.topSites).toHaveLength(2);
    expect(data.bottomSites).toHaveLength(2);
    expect((await dash('?limit=1000')).statusCode).toBe(200);
  });

  test('bad parameters: 400 / 404', async () => {
    for (const q of ['?date=abc', '?date=2026-13-45', '?date=2026-02-30', '?date=10/02/2026', '?limit=0', '?limit=x', '?import=nope']) {
      expect((await dash(q)).statusCode).toBe(400);
    }
    expect((await dash('?import=0123456789abcdef01234567')).statusCode).toBe(404);
  });
});

// Expected values come from a SEPARATE single pass over the workbook (not from the server code)
const classifyRef = (l) => (l === null ? 'no_data' : l >= 80 ? 'critical' : l >= 50 ? 'medium' : 'good');
async function referenceStates(asOf) {
  const { rows } = await readImportFile(fs.readFileSync(REAL), 'xlsx');
  const bySite = new Map();
  rows.forEach((r) => {
    if (asOf && r.endTime > asOf) return;
    const m = r.failure === null ? computeMetrics(r.bins) : null;
    const key = `${r.neId}|${r.neType}`;
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push({ neId: r.neId, neType: r.neType, t: r.endTime.getTime(), load: m && m.ok ? m.p95 : null });
  });
  return [...bySite.values()].map((recs) => {
    const latest = Math.max(...recs.map((x) => x.t));
    const loads = recs.filter((x) => x.t === latest).map((x) => x.load).filter((v) => v !== null);
    return { neId: recs[0].neId, neType: recs[0].neType, load: loads.length ? Math.max(...loads) : null };
  });
}
const countBy = (states) => {
  const c = { critical: 0, medium: 0, good: 0, no_data: 0 };
  states.forEach((s) => { c[classifyRef(s.load)] += 1; });
  return c;
};

(fs.existsSync(REAL) ? describe : describe.skip)('GET /api/v1/dashboard: the real workbook', () => {
  let importId;
  beforeEach(async () => {
    const res = await upload(fs.readFileSync(REAL), 'congestion_data.xlsx');
    expect(res.statusCode).toBe(201);
    importId = res.body.data.import.id;
  });

  test('the whole network: 1194 sites, counts per condition match the reference', async () => {
    const ref = await referenceStates();
    const { data } = (await dash()).body;
    const c = countBy(ref);
    expect(data.totals).toEqual({ sites: 1194, measured: 1194 - c.no_data, noData: c.no_data });
    expect(data.byCondition.critical.count).toBe(c.critical);
    expect(data.byCondition.medium.count).toBe(c.medium);
    expect(data.byCondition.good.count).toBe(c.good);
    expect(data.byCondition.no_data.count).toBe(c.no_data);
    expect(c.no_data).toBe(336); // sites that only ever had PM failures
    expect(data.scope.latestUpdate).toBe('2026-02-15T00:00:00.000Z');
  });

  test('top 10 and bottom 10 match the reference, in the same order', async () => {
    const ref = (await referenceStates()).filter((s) => s.load !== null);
    const desc = [...ref].sort((a, b) => b.load - a.load || a.neId - b.neId || a.neType.localeCompare(b.neType));
    const asc = [...ref].sort((a, b) => a.load - b.load || a.neId - b.neId || a.neType.localeCompare(b.neType));
    const { data } = (await dash()).body;
    expect(data.topSites.map((s) => `${s.neType}|${s.neId}`)).toEqual(desc.slice(0, 10).map((s) => `${s.neType}|${s.neId}`));
    expect(data.bottomSites.map((s) => `${s.neType}|${s.neId}`)).toEqual(asc.slice(0, 10).map((s) => `${s.neType}|${s.neId}`));
    data.topSites.forEach((s, i) => expect(s.load).toBeCloseTo(desc[i].load, 2));
    expect(data.topSites.length).toBe(10);
  });

  test('no grey site ever appears in a ranking', async () => {
    const { data } = (await dash('?limit=50')).body;
    expect([...data.topSites, ...data.bottomSites].every((s) => s.condition !== 'no_data' && s.load !== null)).toBe(true);
  });

  test('as of 10 Feb: only the 200 sites of that day, counts match the reference', async () => {
    const ref = await referenceStates(new Date('2026-02-10T00:00:00Z'));
    const { data } = (await dash('?date=2026-02-10')).body;
    const c = countBy(ref);
    expect(data.totals.sites).toBe(ref.length);
    expect(data.byCondition.critical.count).toBe(c.critical);
    expect(data.byCondition.medium.count).toBe(c.medium);
    expect(data.byCondition.no_data.count).toBe(c.no_data);
  });

  test('scoping on the import gives the same result as the whole network', async () => {
    const all = (await dash()).body.data;
    const scoped = (await dash(`?import=${importId}`)).body.data;
    expect(scoped.totals).toEqual(all.totals);
    expect(scoped.byCondition).toEqual(all.byCondition);
    expect(scoped.topSites).toEqual(all.topSites);
  });

  test('a second import for the same sites replaces their latest state', async () => {
    // Re-export of one known link on a later day with a very different load
    const rows = [rowInBin(CRIT, { NeId: 18870, NeType: 'AMM 20PB', MeasurePoint: "1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1", EndTime: '20/02/2026 00:00:00' })];
    expect((await upload(await makeXlsx(rows), 'later.xlsx')).statusCode).toBe(201);
    const { data } = (await dash('?limit=50')).body;
    expect(data.totals.sites).toBe(1194);
    const site = data.topSites.find((s) => s.neId === 18870);
    expect(site).toMatchObject({ load: 89.75, condition: 'critical', lastUpdate: '2026-02-20T00:00:00.000Z' });
    expect((await dash('?date=2026-02-15')).body.data.topSites.some((s) => s.neId === 18870 && s.load === 89.75)).toBe(false);
  });
});