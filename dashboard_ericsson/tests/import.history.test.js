// History, detail, rows and issues of imports, read back from a REAL database after real uploads.
// Own database (DATABASE_TEST + "-history"), emptied after each test and dropped at the end.
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
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, goodRow, failureRow } = require('./helpers/xlsx');

const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
const MODELS = [Site, Link, Import, ImportIssue, Measurement];
const BAD_ID = '0123456789abcdef01234567'; // valid format, does not exist

const upload = (buffer, name = 'data.xlsx') => request(app).post('/api/v1/imports').attach('file', buffer, name);
const get = (url) => request(app).get(url);
// Uploads a synthetic file and returns the import id
const seed = async (rows, name) => (await upload(await makeXlsx(rows), name)).body.data.import.id;

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-history`;
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

describe('GET /api/v1/imports (history)', () => {
  test('empty database: 200 with an empty list', async () => {
    const res = await get('/api/v1/imports');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'success', results: 0, total: 0, page: 1, pages: 0 });
    expect(res.body.data.imports).toEqual([]);
  });

  test('newest first, numbered by order of arrival, with the fields of the history screen', async () => {
    const first = await seed([goodRow()], 'congestion_data_2.xlsx');
    const second = await seed([goodRow({ EndTime: '11/02/2026 00:00:00' })], 'congestion_data.xlsx');
    const res = await get('/api/v1/imports');
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
    const [a, b] = res.body.data.imports;
    expect(a).toMatchObject({ number: 2, id: second, fileName: 'congestion_data.xlsx', status: 'successful', sitesCount: 1 });
    expect(b).toMatchObject({ number: 1, id: first, fileName: 'congestion_data_2.xlsx' });
    expect(new Date(a.importedAt) >= new Date(b.importedAt)).toBe(true);
    expect(a.counts).toMatchObject({ rowsTotal: 1, valid: 1 });
  });

  test('pagination: page 2 with limit 1 gives the older import (number 1)', async () => {
    await seed([goodRow()]);
    await seed([goodRow({ EndTime: '11/02/2026 00:00:00' })]);
    const res = await get('/api/v1/imports?limit=1&page=2');
    expect(res.body).toMatchObject({ results: 1, total: 2, page: 2, pages: 2 });
    expect(res.body.data.imports[0].number).toBe(1);
  });

  test('bad pagination values are a 400, a huge limit is clamped to 100', async () => {
    for (const q of ['page=0', 'page=abc', 'limit=-1', 'limit=1.5', 'page=1&page=2']) {
      expect((await get(`/api/v1/imports?${q}`)).statusCode).toBe(400);
    }
    expect((await get('/api/v1/imports?limit=100000')).statusCode).toBe(200);
  });

  test('an import still "processing" is invisible', async () => {
    await Import.create({ fileName: 'x.xlsx', fileType: 'xlsx', fileSize: 1, sha256: 'c'.repeat(64) });
    const res = await get('/api/v1/imports');
    expect(res.body.total).toBe(0);
  });
});

describe('GET /api/v1/imports/:id (detail)', () => {
  test('summary, issue totals and the days covered', async () => {
    const id = await seed([
      goodRow(),
      failureRow({ NeId: 21952, MeasurePoint: '1/11/105' }),
      goodRow({ NeId: 5000, MeasurePoint: '1/11/106', EndTime: '11/02/2026 00:00:00', '0-5': 7 }), // rejected
      goodRow({ NeId: 7000, NeType: 'AMM 6PB', MeasurePoint: '1/11/107', EndTime: '11/02/2026 00:00:00' }),
      goodRow({ NeId: 7000, NeType: 'SIU 02', MeasurePoint: '1/11/107', EndTime: '11/02/2026 00:00:00' }), // 2 types for NeId 7000
    ]);
    const res = await get(`/api/v1/imports/${id}`);
    expect(res.statusCode).toBe(200);
    const imp = res.body.data.import;
    expect(imp).toMatchObject({ id, number: 1, status: 'successful', fileType: 'xlsx', sitesCount: 4 });
    expect(imp.counts).toMatchObject({ rowsTotal: 5, valid: 3, failed: 1, rejected: 1, skipped: 0 });
    expect(imp.issues).toEqual({ errors: 1, warnings: 2, byCode: { BINS_SUM_MISMATCH: 1, NEID_MULTIPLE_NETYPE: 2 } });
    expect(imp.days).toEqual([
      { date: '2026-02-10', total: 2, valid: 1, failed: 1 },
      { date: '2026-02-11', total: 2, valid: 2, failed: 0 },
    ]);
  });

  test('unknown id: 404, malformed id: 400', async () => {
    expect((await get(`/api/v1/imports/${BAD_ID}`)).statusCode).toBe(404);
    expect((await get('/api/v1/imports/not-an-id')).statusCode).toBe(400);
    expect((await get(`/api/v1/imports/${BAD_ID}/rows`)).statusCode).toBe(404);
    expect((await get(`/api/v1/imports/${BAD_ID}/issues`)).statusCode).toBe(404);
  });

  test('a processing import has no detail page (404)', async () => {
    const doc = await Import.create({ fileName: 'x.xlsx', fileType: 'xlsx', fileSize: 1, sha256: 'd'.repeat(64) });
    expect((await get(`/api/v1/imports/${doc._id}`)).statusCode).toBe(404);
  });
});

describe('GET /api/v1/imports/:id/rows', () => {
  let id;
  beforeEach(async () => {
    id = await seed([
      goodRow({ NeId: 18870, MeasurePoint: '1/11/104' }),
      failureRow({ NeId: 21952, MeasurePoint: '1/11/105' }),
      goodRow({ NeId: 2897, NeType: 'AMM 6PB', MeasurePoint: '1/14/120' }),
    ]);
  });

  test('all rows in file order, with site, link and result columns', async () => {
    const res = await get(`/api/v1/imports/${id}/rows`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: 3, total: 3, page: 1, pages: 1 });
    const [r1, r2, r3] = res.body.data.rows;
    expect([r1.sourceRow, r2.sourceRow, r3.sourceRow]).toEqual([2, 3, 4]);
    expect(r1).toMatchObject({
      neId: 18870, neType: 'AMM 20PB', wilayaCode: 18, measurePoint: '1/11/104', portRef: '1/11/104',
      entityType: 'MLTN WAN Eth Bandwidth RX', endTime: '2026-02-10T00:00:00.000Z', status: 'OK', totalSeconds: 86400,
    });
    expect(r1.bins).toHaveLength(20);
    expect(typeof r1.p95).toBe('number');
    expect(r3).toMatchObject({ neId: 2897, wilayaCode: 2, neType: 'AMM 6PB' });
  });

  test('a failure row carries its message and no result', async () => {
    const row = (await get(`/api/v1/imports/${id}/rows?filter=failed`)).body.data.rows[0];
    expect(row).toMatchObject({ neId: 21952, status: 'PM_INVALID', failure: 'PM Failure - NE PM data is invalid' });
    expect(row.p95).toBeNull();
    expect(row.totalSeconds).toBeNull();
  });

  test('filters valid / failed and NeId search', async () => {
    expect((await get(`/api/v1/imports/${id}/rows?filter=valid`)).body.total).toBe(2);
    expect((await get(`/api/v1/imports/${id}/rows?filter=failed`)).body.total).toBe(1);
    const found = await get(`/api/v1/imports/${id}/rows?q=2897`);
    expect(found.body.total).toBe(1);
    expect(found.body.data.rows[0].neId).toBe(2897);
    expect((await get(`/api/v1/imports/${id}/rows?q=99999`)).body.total).toBe(0);
  });

  test('pagination', async () => {
    const res = await get(`/api/v1/imports/${id}/rows?limit=2&page=2`);
    expect(res.body).toMatchObject({ results: 1, total: 3, page: 2, pages: 2 });
    expect(res.body.data.rows[0].sourceRow).toBe(4);
  });

  test('invalid filter or search value is a 400', async () => {
    expect((await get(`/api/v1/imports/${id}/rows?filter=weird`)).statusCode).toBe(400);
    expect((await get(`/api/v1/imports/${id}/rows?q=abc`)).statusCode).toBe(400);
    expect((await get(`/api/v1/imports/${id}/rows?limit=0`)).statusCode).toBe(400);
  });

  test('rows of one import never leak into another', async () => {
    const other = await seed([goodRow({ NeId: 4444, MeasurePoint: '1/11/109' })]);
    const res = await get(`/api/v1/imports/${other}/rows`);
    expect(res.body.total).toBe(1);
    expect(res.body.data.rows[0].neId).toBe(4444);
  });
});

describe('GET /api/v1/imports/:id/issues', () => {
  let id;
  beforeEach(async () => {
    id = await seed([
      goodRow({ NeId: 7000, NeType: 'AMM 6PB', MeasurePoint: '1/11/104' }),
      goodRow({ NeId: 7000, NeType: 'SIU 02', MeasurePoint: '1/11/105' }),
      goodRow({ NeId: 5000, MeasurePoint: '1/11/106', '0-5': 7 }),
    ]);
  });

  test('all issues, then filtered by severity and by code', async () => {
    const all = await get(`/api/v1/imports/${id}/issues`);
    expect(all.body.total).toBe(3);
    const errors = await get(`/api/v1/imports/${id}/issues?severity=error`);
    expect(errors.body.data.issues).toEqual([
      { sourceRow: 4, severity: 'error', code: 'BINS_SUM_MISMATCH', message: expect.stringContaining('86400') },
    ]);
    const warnings = await get(`/api/v1/imports/${id}/issues?severity=warning&code=NEID_MULTIPLE_NETYPE`);
    expect(warnings.body.total).toBe(2);
    expect(warnings.body.data.issues.map((i) => i.sourceRow)).toEqual([2, 3]);
  });

  test('invalid severity or code is a 400', async () => {
    expect((await get(`/api/v1/imports/${id}/issues?severity=info`)).statusCode).toBe(400);
    expect((await get(`/api/v1/imports/${id}/issues?code=lower_case`)).statusCode).toBe(400);
  });
});

(fs.existsSync(REAL) ? describe : describe.skip)('the real workbook', () => {
  let id;
  beforeEach(async () => {
    const res = await upload(fs.readFileSync(REAL), 'congestion_data.xlsx');
    expect(res.statusCode).toBe(201);
    id = res.body.data.import.id;
  });

  test('history shows it as import number 1 with 1194 sites', async () => {
    const res = await get('/api/v1/imports');
    expect(res.body.data.imports[0]).toMatchObject({ number: 1, fileName: 'congestion_data.xlsx', sitesCount: 1194, status: 'successful' });
  });

  test('detail: six days of 200 rows, 56 warnings and no error', async () => {
    const imp = (await get(`/api/v1/imports/${id}`)).body.data.import;
    expect(imp.days).toEqual([
      { date: '2026-02-10', total: 200, valid: 151, failed: 49 },
      { date: '2026-02-11', total: 200, valid: 138, failed: 62 },
      { date: '2026-02-12', total: 200, valid: 139, failed: 61 },
      { date: '2026-02-13', total: 200, valid: 153, failed: 47 },
      { date: '2026-02-14', total: 200, valid: 140, failed: 60 },
      { date: '2026-02-15', total: 200, valid: 141, failed: 59 },
    ]);
    expect(imp.issues).toEqual({ errors: 0, warnings: 56, byCode: { NEID_MULTIPLE_NETYPE: 56 } });
  });

  test('rows: 862 valid, 338 failed, 1200 in total, 50 per page by default', async () => {
    expect((await get(`/api/v1/imports/${id}/rows?filter=valid&limit=1`)).body.total).toBe(862);
    expect((await get(`/api/v1/imports/${id}/rows?filter=failed&limit=1`)).body.total).toBe(338);
    const all = await get(`/api/v1/imports/${id}/rows`);
    expect(all.body).toMatchObject({ results: 50, total: 1200, pages: 24 });
  });

  test('rows: the worked example is found by NeId, with its 2192 s and P95', async () => {
    const res = await get(`/api/v1/imports/${id}/rows?q=18870`);
    expect(res.body.total).toBe(1);
    const row = res.body.data.rows[0];
    expect(row).toMatchObject({ neType: 'AMM 20PB', wilayaCode: 18, status: 'OK', endTime: '2026-02-10T00:00:00.000Z' });
    expect(row.p95).toBeCloseTo(62.7021, 3);
    expect(row.bins.slice(16).reduce((a, b) => a + b, 0)).toBe(2192);
  });

  test('issues: 56 warnings, paginated', async () => {
    const res = await get(`/api/v1/imports/${id}/issues?severity=warning&limit=20&page=3`);
    expect(res.body).toMatchObject({ results: 16, total: 56, page: 3, pages: 3 });
    expect((await get(`/api/v1/imports/${id}/issues?severity=error`)).body.total).toBe(0);
  });
});