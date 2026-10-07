// "All sites" list and site page, read from a REAL database after real uploads.
// Own database (DATABASE_TEST + "-sites"), emptied after each test and dropped at the end.
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
const BAD_ID = '0123456789abcdef01234567'; // valid format, does not exist
// P95 produced by rowInBin: 5 * bin + 4.75
const CRIT = 17; // 89.75
const MED = 12; // 64.75
const GOOD = 0; // 4.75
const day = (d) => `${String(d).padStart(2, '0')}/02/2026 00:00:00`;

const upload = (buffer, name = 'data.xlsx') => request(app).post('/api/v1/imports').attach('file', buffer, name);
const seed = async (rows) => (await upload(await makeXlsx(rows))).body.data.import.id;
const list = (query = '') => request(app).get(`/api/v1/sites${query}`);
const siteIdOf = async (neId, neType) => String((await Site.findOne(neType ? { neId, neType } : { neId }).lean())._id);
const detail = async (neId, query = '', neType) => request(app).get(`/api/v1/sites/${await siteIdOf(neId, neType)}${query}`);

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-sites`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all(MODELS.map((M) => M.init()));
    await loginAsAdmin();
});
let keepData = false; // the real-workbook tests only READ, so they import the file once and keep it
afterEach(async () => {
  if (!keepData && mongoose.connection.readyState === 1) await Promise.all(MODELS.map((M) => M.deleteMany({})));
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('GET /api/v1/sites (list): synthetic data', () => {
  test('empty database: 200 with an empty page', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: 0, total: 0, page: 1, pages: 0, from: 0, to: 0 });
    expect(res.body.data.sites).toEqual([]);
  });

  test('highest load first, grey last; lowest first keeps grey last', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 6006, MeasurePoint: '1/11/1' }),
      rowInBin(GOOD, { NeId: 3003, MeasurePoint: '1/11/1' }),
      failureRow({ NeId: 4004, MeasurePoint: '1/11/1' }),
    ]);
    const desc = (await list()).body.data.sites;
    expect(desc.map((s) => s.neId)).toEqual([1001, 2002, 6006, 3003, 4004]);
    expect(desc.map((s) => s.condition)).toEqual(['critical', 'medium', 'medium', 'good', 'no_data']);
    expect(desc[4]).toMatchObject({ load: null, condition: 'no_data', noMeasurementReason: 'PM Failure - NE PM data is invalid' });
    expect(desc[0].noMeasurementReason).toBeNull();
    expect(desc[0]).toMatchObject({ load: 89.75, wilayaCode: 1, wilayaName: 'Adrar', neType: 'AMM 20PB', lastUpdate: '2026-02-10T00:00:00.000Z' });
    const asc = (await list('?sort=load_asc')).body.data.sites;
    expect(asc.map((s) => s.neId)).toEqual([3003, 2002, 6006, 1001, 4004]);
  });

  test('filters: NeId start, wilaya, condition, and combined', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 16002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1' }),
      rowInBin(MED, { NeId: 20021, MeasurePoint: '1/11/1' }),
      failureRow({ NeId: 5005, MeasurePoint: '1/11/1' }),
    ]);
    expect((await list('?neId=20')).body.data.sites.map((s) => s.neId).sort()).toEqual([2002, 20021]);
    expect((await list('?wilaya=16')).body.total).toBe(2);
    expect((await list('?condition=medium')).body.total).toBe(3);
    expect((await list('?condition=no_data')).body.data.sites.map((s) => s.neId)).toEqual([5005]);
    const both = (await list('?wilaya=16&condition=critical')).body;
    expect(both.total).toBe(1);
    expect(both.data.sites[0].neId).toBe(16001);
    expect((await list('?wilaya=58')).body.total).toBe(0);
  });

  test('pagination: showing from-to, pages, limit', async () => {
    await seed([1, 2, 3, 4, 5].map((n) => rowInBin(MED, { NeId: 1000 + n, MeasurePoint: '1/11/1' })));
    const p1 = (await list('?limit=2')).body;
    expect(p1).toMatchObject({ results: 2, total: 5, page: 1, pages: 3, from: 1, to: 2 });
    const p3 = (await list('?limit=2&page=3')).body;
    expect(p3).toMatchObject({ results: 1, page: 3, from: 5, to: 5 });
    expect((await list('?limit=2&page=9')).body).toMatchObject({ results: 0, total: 5, from: 0, to: 16 });
    expect((await list('?limit=100000')).statusCode).toBe(200);
  });

  test('date = as of that day, import = only that import', async () => {
    const first = await seed([rowInBin(CRIT, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: day(10) })]);
    await seed([
      rowInBin(GOOD, { NeId: 1001, MeasurePoint: '1/11/1', EndTime: day(12) }),
      rowInBin(MED, { NeId: 2002, MeasurePoint: '1/11/1', EndTime: day(12) }),
    ]);
    const asOf = (await list('?date=2026-02-11')).body;
    expect(asOf.total).toBe(1);
    expect(asOf.data.sites[0]).toMatchObject({ neId: 1001, load: 89.75, condition: 'critical' });
    expect(asOf.data.scope.asOf).toBe('2026-02-11');
    expect((await list()).body.data.sites.find((s) => s.neId === 1001)).toMatchObject({ load: 4.75, condition: 'good' });
    const scoped = (await list(`?import=${first}`)).body;
    expect(scoped.total).toBe(1);
    expect(scoped.data.scope.import).toBe(first);
  });

  test('bad parameters are a 400, an unknown import a 404', async () => {
    for (const q of ['?neId=abc', '?wilaya=0', '?wilaya=100', '?condition=weird', '?sort=up', '?limit=0', '?page=0', '?date=2026-02-30', '?import=nope']) {
      expect((await list(q)).statusCode).toBe(400);
    }
    expect((await list(`?import=${BAD_ID}`)).statusCode).toBe(404);
  });
});

describe('GET /api/v1/sites/:id (site page): synthetic data', () => {
  test('three days: history, summary, current state and report', async () => {
    await seed([
      rowInBin(GOOD, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(10) }),
      rowInBin(MED, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(11) }),
      rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(12) }),
    ]);
    const res = await detail(16001);
    expect(res.statusCode).toBe(200);
    const { data } = res.body;
    expect(data.site).toMatchObject({ neId: 16001, neType: 'AMM 20PB', wilayaCode: 16, wilayaName: 'Alger' });
    expect(data.current).toMatchObject({ load: 89.75, condition: 'critical', lastUpdate: '2026-02-12T00:00:00.000Z', failureReasons: [] });
    expect(data.history.map((h) => [h.date, h.load, h.condition])).toEqual([
      ['2026-02-10', 4.75, 'good'], ['2026-02-11', 64.75, 'medium'], ['2026-02-12', 89.75, 'critical'],
    ]);
    expect(data.summary).toEqual({ windowDays: 3, measuredDays: 3, average: 53.08, maximum: 89.75, minimum: 4.75 });
    expect(data.report.level).toBe('critical');
    expect(data.report.text).toContain('80%');
    expect(data.thresholds).toEqual({ metric: 'p95', mediumFrom: 50, criticalFrom: 80 });
    expect(data.links).toHaveLength(1);
    expect(data.links[0]).toMatchObject({ measurePoint: '1/11/1', entityType: 'MLTN WAN Eth Bandwidth RX', isWorst: true, load: 89.75 });
    expect(data.links[0].bins).toHaveLength(20);
  });

  test('only the last 7 days of a longer history', async () => {
    await seed(Array.from({ length: 9 }, (_, i) => rowInBin(i + 1, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(i + 1) })));
    const { data } = (await detail(16001)).body;
    expect(data.history.map((h) => h.date)).toEqual(['2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07', '2026-02-08', '2026-02-09']);
    expect(data.summary).toMatchObject({ windowDays: 7, average: 34.75, maximum: 49.75, minimum: 19.75 });
  });

  test('a failed day is a gap (null) and a failed LATEST day makes the site grey, with its reason', async () => {
    await seed([
      rowInBin(MED, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(10) }),
      failureRow({ NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(11) }),
    ]);
    const { data } = (await detail(16001)).body;
    expect(data.history.map((h) => h.load)).toEqual([64.75, null]);
    expect(data.current).toMatchObject({ load: null, condition: 'no_data', failureReasons: ['PM Failure - NE PM data is invalid'], noMeasurementReason: 'PM Failure - NE PM data is invalid' });
    expect(data.report.level).toBe('no_data');
    expect(data.summary).toMatchObject({ windowDays: 2, measuredDays: 1, average: 64.75 });
  });

  test('two links on the same day: the worst one counts and is flagged', async () => {
    await seed([
      rowInBin(GOOD, { NeId: 16001, MeasurePoint: '1/11/1' }),
      rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/2' }),
    ]);
    const { data } = (await detail(16001)).body;
    expect(data.current.load).toBe(89.75);
    expect(data.links.map((l) => [l.measurePoint, l.isWorst])).toEqual([['1/11/2', true], ['1/11/1', false]]);
    expect(data.history[0]).toMatchObject({ measuredLinks: 2, totalLinks: 2 });
  });

  test('date = the page as of that day; a day before the first record is a 404', async () => {
    await seed([
      rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(10) }),
      rowInBin(GOOD, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(12) }),
    ]);
    const asOf = (await detail(16001, '?date=2026-02-11')).body.data;
    expect(asOf.history).toHaveLength(1);
    expect(asOf.current).toMatchObject({ load: 89.75, condition: 'critical' });
    expect((await detail(16001, '?date=2026-02-09')).statusCode).toBe(404);
  });

  test('import scope: only the records of that import', async () => {
    const first = await seed([rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(10) })]);
    await seed([rowInBin(GOOD, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: day(12) })]);
    const scoped = (await detail(16001, `?import=${first}`)).body.data;
    expect(scoped.history).toHaveLength(1);
    expect(scoped.current.load).toBe(89.75);
  });

  test('malformed id: 400, unknown id: 404, bad date: 400', async () => {
    expect((await request(app).get('/api/v1/sites/not-an-id')).statusCode).toBe(400);
    expect((await request(app).get(`/api/v1/sites/${BAD_ID}`)).statusCode).toBe(404);
    await seed([rowInBin(MED, { NeId: 16001, MeasurePoint: '1/11/1' })]);
    expect((await detail(16001, '?date=nope')).statusCode).toBe(400);
  });

  test('the list gives the siteId that opens the page of the same site', async () => {
    await seed([rowInBin(CRIT, { NeId: 16001, MeasurePoint: '1/11/1' })]);
    const [item] = (await list()).body.data.sites;
    const page = await request(app).get(`/api/v1/sites/${item.siteId}`);
    expect(page.statusCode).toBe(200);
    expect(page.body.data.site.neId).toBe(16001);
    expect(page.body.data.current.load).toBe(item.load);
  });
});

// Reference computed in a SEPARATE pass over the workbook (not by the server code)
async function referenceDays(neId, neType) {
  const { rows } = await readImportFile(fs.readFileSync(REAL), 'xlsx');
  const days = new Map();
  rows.filter((r) => r.neId === neId && r.neType === neType).forEach((r) => {
    const key = r.endTime.toISOString().slice(0, 10);
    const m = r.failure === null ? computeMetrics(r.bins) : null;
    const load = m && m.ok ? m.p95 : null;
    const d = days.get(key) || { date: key, load: null, records: 0, measured: 0 };
    d.records += 1;
    if (load !== null) { d.measured += 1; if (d.load === null || load > d.load) d.load = load; }
    days.set(key, d);
  });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

(fs.existsSync(REAL) ? describe : describe.skip)('sites on the real workbook', () => {
  let importId;
  beforeAll(async () => {
    const res = await upload(fs.readFileSync(REAL), 'congestion_data.xlsx');
    expect(res.statusCode).toBe(201);
    importId = res.body.data.import.id;
    keepData = true;
  });
  afterAll(() => { keepData = false; });

  test('the list: 1194 sites, 100 per page, "showing 1-100", 12 pages', async () => {
    const res = await list();
    expect(res.body).toMatchObject({ results: 100, total: 1194, page: 1, pages: 12, from: 1, to: 100 });
    expect((await list('?page=12')).body).toMatchObject({ results: 94, from: 1101, to: 1194 });
  });

  test('the list sorted high to low starts like the dashboard top 10', async () => {
    const top = (await request(app).get('/api/v1/dashboard')).body.data.topSites.map((s) => s.siteId);
    const first = (await list('?limit=10')).body.data.sites.map((s) => s.siteId);
    expect(first).toEqual(top);
  });

  test('grey sites come after the 858 measured ones, in both directions', async () => {
    for (const sort of ['load_desc', 'load_asc']) {
      const { sites } = (await list(`?sort=${sort}&page=5&limit=200`)).body.data; // items 801 to 1000
      expect(sites.slice(0, 58).every((s) => s.load !== null)).toBe(true);
      expect(sites.slice(58).every((s) => s.load === null && s.condition === 'no_data')).toBe(true);
      expect(sites).toHaveLength(200);
    }
  });

  test('condition filters: 69 critical, 789 medium, 0 good, 336 without measurement', async () => {
    expect((await list('?condition=critical')).body.total).toBe(69);
    expect((await list('?condition=medium')).body.total).toBe(789);
    expect((await list('?condition=good')).body.total).toBe(0);
    expect((await list('?condition=no_data')).body.total).toBe(336);
  });

  test('wilaya filter: Skikda (21) has 41 sites, 8 of them critical', async () => {
    expect((await list('?wilaya=21')).body.total).toBe(41);
    const crit = (await list('?wilaya=21&condition=critical')).body;
    expect(crit.total).toBe(8);
    expect(crit.data.sites.every((s) => s.wilayaName === 'Skikda')).toBe(true);
  });

  test('search by NeId: 18870 finds exactly one site', async () => {
    const res = await list('?neId=18870');
    expect(res.body.total).toBe(1);
    expect(res.body.data.sites[0]).toMatchObject({ neId: 18870, neType: 'AMM 20PB', wilayaName: 'Jijel', load: 62.7, condition: 'medium' });
  });

  test('as of 10 Feb: 200 sites; scoped to the import: 1194', async () => {
    expect((await list('?date=2026-02-10')).body.total).toBe(200);
    expect((await list(`?import=${importId}`)).body.total).toBe(1194);
  });

  test('the page of the worked example (NeId 18870): one day, one link, 2192 s above 80 %', async () => {
    const { data } = (await detail(18870)).body;
    expect(data.site).toMatchObject({ neId: 18870, wilayaName: 'Jijel' });
    expect(data.current).toMatchObject({ load: 62.7, condition: 'medium', lastUpdate: '2026-02-10T00:00:00.000Z' });
    expect(data.history).toHaveLength(1);
    expect(data.summary).toMatchObject({ windowDays: 1, measuredDays: 1, average: 62.7, maximum: 62.7, minimum: 62.7 });
    expect(data.links).toHaveLength(1);
    expect(data.links[0].measurePoint).toContain('1/11/106');
    expect(data.links[0].bins.reduce((a, b) => a + b, 0)).toBe(86400);
    expect(data.links[0].bins.slice(16).reduce((a, b) => a + b, 0)).toBe(2192);
    expect(data.report.level).toBe('medium');
  });

  test.each([
    [11262, 'AMM 20PB'], // two days (10 and 15 Feb), two links
    [20504, 'MSTB1'], // two days (10 and 12 Feb), two links
    [3094, 'AMM 20PB'], // two days (11 and 15 Feb), one failure among them
    [24915, 'AMM 6PB'], // one day, two links, one failed
    [22993, 'SIU 02'], // one day, two links
  ])('real site %i %s: history matches an independent calculation', async (neId, neType) => {
    const ref = await referenceDays(neId, neType);
    const { data } = (await detail(neId, '', neType)).body;
    expect(data.history.map((h) => h.date)).toEqual(ref.map((d) => d.date));
    data.history.forEach((h, i) => {
      if (ref[i].load === null) expect(h.load).toBeNull();
      else expect(h.load).toBeCloseTo(ref[i].load, 2);
      expect(h.totalLinks).toBe(ref[i].records);
      expect(h.measuredLinks).toBe(ref[i].measured);
    });
    expect(data.links.length).toBe(2);
  });

  test('real site 11262: its two links were seen on different days, the current one comes first', async () => {
    const { data } = (await detail(11262, '', 'AMM 20PB')).body;
    expect(data.links).toHaveLength(2);
    expect(data.links[0]).toMatchObject({ onLatestDay: true, isWorst: true });
    expect(data.links[1]).toMatchObject({ onLatestDay: false, isWorst: false });
    expect(data.links[0].endTime).toBe(data.current.lastUpdate);
    expect(data.links[0].load).toBe(data.current.load);
  });

  test('a site with one failed link and one measured link on the same day is not grey (24915)', async () => {
    const { data } = (await detail(24915, '', 'AMM 6PB')).body;
    expect(data.history[0]).toMatchObject({ measuredLinks: 1, totalLinks: 2 });
    expect(data.current.load).not.toBeNull();
    expect(data.links.filter((l) => l.status !== 'OK')).toHaveLength(1);
    expect(data.links.filter((l) => l.isWorst)).toHaveLength(1);
  });

  test('a site that only ever failed is grey, with the reason (a no-data site from the list)', async () => {
    const [grey] = (await list('?condition=no_data&limit=1')).body.data.sites;
    const { data } = (await request(app).get(`/api/v1/sites/${grey.siteId}`)).body;
    expect(data.current.condition).toBe('no_data');
    expect(data.current.load).toBeNull();
    expect(data.current.failureReasons.length).toBeGreaterThan(0);
    expect(grey.noMeasurementReason).toBe(data.current.noMeasurementReason);
    expect(grey.noMeasurementReason).toBeTruthy();
    expect(data.summary.average).toBeNull();
    expect(data.report.level).toBe('no_data');
  });
});