// End-to-end: HTTP upload -> read -> validate -> write to a REAL database -> read back.
// Own database (DATABASE_TEST + "-import"), emptied after each test and dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { request, loginAsAdmin } = require('./helpers/auth');
const ExcelJS = require('exceljs');
const app = require('../app');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Measurement = require('../models/measurementModel');
const { REQUIRED_COLUMNS } = require('../utils/excelReader');
const { testConnectOptions } = require('./helpers/dbConnect');

const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
const hasReal = fs.existsSync(REAL);
const MODELS = [Site, Link, Import, ImportIssue, Measurement];
const counts = async () => Object.fromEntries(await Promise.all(MODELS.map(async (M) => [M.modelName, await M.countDocuments()])));
const EMPTY = { Site: 0, Link: 0, Import: 0, ImportIssue: 0, Measurement: 0 };

const post = (buffer, name = 'data.xlsx') => request(app).post('/api/v1/imports').attach('file', buffer, name);

// Small synthetic workbook: rows = array of objects keyed by column name
async function makeXlsx(rows, headers = REQUIRED_COLUMNS) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Congestion');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h] ?? null)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const goodRow = (over = {}) => ({
  NeId: 18870, NeType: 'AMM 20PB', EntityType: 'MLTN WAN Eth Bandwidth RX', MeasurePoint: '1/11/104',
  EndTime: '10/02/2026 00:00:00', Failure: null, Avg: 5, Max: 9, Min: 1,
  ...Object.fromEntries(REQUIRED_COLUMNS.slice(9).map((c, i) => [c, i === 0 ? 86400 : 0])), ...over,
});

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-import`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all(MODELS.map((M) => M.init()));
    await loginAsAdmin();
});
afterEach(async () => {
  jest.restoreAllMocks();
  if (mongoose.connection.readyState === 1) await Promise.all(MODELS.map((M) => M.deleteMany({})));
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('POST /api/v1/imports: refusals leave the database untouched', () => {
  test('no file: 400', async () => {
    const res = await request(app).post('/api/v1/imports');
    expect(res.statusCode).toBe(400);
    expect(res.body.status).toBe('fail');
  });
  test('unsupported extension: 415', async () => {
    const res = await post(Buffer.from('x'), 'report.pdf');
    expect(res.statusCode).toBe(415);
    expect(await counts()).toEqual(EMPTY);
  });
  test('file field with the wrong name: 400', async () => {
    const res = await request(app).post('/api/v1/imports').attach('document', Buffer.from('x'), 'a.xlsx');
    expect(res.statusCode).toBe(400);
  });
    test('malformed multipart body (line break inside the key name): 400, not 500', async () => {
    const b = 'xBOUNDARYx';
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file\n"; filename="a.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from('data'),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const res = await request(app).post('/api/v1/imports')
      .set('Content-Type', `multipart/form-data; boundary=${b}`).send(body);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('malformed');
    expect(await counts()).toEqual(EMPTY);
  });
  test('missing column: 422 naming it, nothing stored', async () => {
    const headers = REQUIRED_COLUMNS.filter((c) => c !== '90-95');
    const res = await post(await makeXlsx([goodRow()], headers));
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toContain('90-95');
    expect(await counts()).toEqual(EMPTY);
  });
  test('unreadable file: 422, nothing stored', async () => {
    const res = await post(Buffer.from('this is not an excel file'));
    expect(res.statusCode).toBe(422);
    expect(await counts()).toEqual(EMPTY);
  });
  test('every row rejected: 422, nothing stored (no Import, no Site)', async () => {
    const res = await post(await makeXlsx([goodRow({ '0-5': 5 })])); // sum != 86400
    expect(res.statusCode).toBe(422);
    expect(res.body.message).toContain('rejected');
    expect(await counts()).toEqual(EMPTY);
  });
});

describe('POST /api/v1/imports: small synthetic files', () => {
  test('one valid row and one failure row are stored; failure has no results', async () => {
    const failRow = goodRow({
      NeId: 21952, MeasurePoint: '1/11/105', Failure: 'PM Failure - NE PM data is invalid',
      ...Object.fromEntries(REQUIRED_COLUMNS.slice(9).map((c) => [c, 0])),
    });
    const res = await post(await makeXlsx([goodRow(), failRow]));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.import.counts).toMatchObject({ rowsTotal: 2, valid: 1, failed: 1, rejected: 0, skipped: 0 });
    expect(res.body.data.import.sitesCount).toBe(2);
    expect(await counts()).toMatchObject({ Site: 2, Link: 2, Measurement: 2, Import: 1 });
    const fail = await Measurement.findOne({ status: 'PM_INVALID' }).lean();
    expect(fail.p95).toBeNull();
    expect(fail.totalSeconds).toBeNull();
    expect((await Site.findOne({ neId: 21952 }).lean()).wilayaCode).toBe(21);
  });

  test('a rejected row next to a good one: good one stored, rejected counted, issue kept', async () => {
    const res = await post(await makeXlsx([goodRow(), goodRow({ NeId: 5000, '0-5': 7 })]));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.import.counts).toMatchObject({ rowsTotal: 2, valid: 1, rejected: 1 });
    expect(await ImportIssue.countDocuments({ severity: 'error', code: 'BINS_SUM_MISMATCH' })).toBe(1);
    expect(await Site.countDocuments({ neId: 5000 })).toBe(0);
  });

  test('same file twice: the second is refused (409) and nothing changes', async () => {
    const file = await makeXlsx([goodRow()]);
    expect((await post(file)).statusCode).toBe(201);
    const before = await counts();
    const res = await post(file);
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain('already imported');
    expect(await counts()).toEqual(before);
  });

  test('different file with the same link and day: nothing new (409), nothing changes', async () => {
    expect((await post(await makeXlsx([goodRow()]))).statusCode).toBe(201);
    const before = await counts();
    const res = await post(await makeXlsx([goodRow({ Avg: 6 })])); // other bytes, same link + day
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain('Nothing new');
    expect(await counts()).toEqual(before);
  });

  test('overlap: new days are added, known (link, day) rows are skipped with a warning', async () => {
    expect((await post(await makeXlsx([goodRow()]))).statusCode).toBe(201);
    const res = await post(await makeXlsx([goodRow({ Avg: 6 }), goodRow({ EndTime: '11/02/2026 00:00:00' })]));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.import.counts).toMatchObject({ rowsTotal: 2, valid: 1, skipped: 1 });
    expect(await Measurement.countDocuments()).toBe(2);
    expect(await Site.countDocuments()).toBe(1);
    expect(await Link.countDocuments()).toBe(1);
    expect(await ImportIssue.countDocuments({ code: 'DUPLICATE_OF_EXISTING' })).toBe(1);
  });

  test('a failure while writing rolls everything back (no import, site, link or measurement left)', async () => {
    jest.spyOn(Measurement, 'insertMany').mockRejectedValue(new Error('disk exploded'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(await makeXlsx([goodRow()]));
    expect(res.statusCode).toBe(500);
    expect(await counts()).toEqual(EMPTY);
  });

  test('rollback keeps sites and links that existed before the failed import', async () => {
    expect((await post(await makeXlsx([goodRow()]))).statusCode).toBe(201);
    const before = await counts();
    jest.spyOn(Measurement, 'insertMany').mockRejectedValue(new Error('disk exploded'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(await makeXlsx([goodRow({ EndTime: '12/02/2026 00:00:00' })]));
    expect(res.statusCode).toBe(500);
    expect(await counts()).toEqual(before);
  });

  test('CSV (semicolon) goes through the same pipeline', async () => {
    const xlsx = await makeXlsx([goodRow()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx);
    const csv = Buffer.from(await wb.csv.writeBuffer({ formatterOptions: { delimiter: ';' } }));
    const res = await post(csv, 'data.csv');
    expect(res.statusCode).toBe(201);
    expect(res.body.data.import.fileType).toBe('csv');
    expect(res.body.data.import.counts.valid).toBe(1);
  });
});

(hasReal ? describe : describe.skip)('POST /api/v1/imports: the real workbook', () => {
  test('imports 1200 rows: 862 measured, 338 failures, 1194 sites, 1200 links', async () => {
    const res = await post(fs.readFileSync(REAL), 'congestion_data.xlsx');
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Import completed successfully');
    const imp = res.body.data.import;
    expect(imp.counts).toEqual({ rowsTotal: 1200, valid: 862, failed: 338, rejected: 0, skipped: 0, withWarnings: 56 });
    expect(imp.sitesCount).toBe(1194);
    expect(imp.periodFrom).toBe('2026-02-10T00:00:00.000Z');
    expect(imp.periodTo).toBe('2026-02-15T00:00:00.000Z');

    expect(await counts()).toEqual({ Site: 1194, Link: 1200, Import: 1, ImportIssue: 56, Measurement: 1200 });
    expect(await Measurement.countDocuments({ status: 'OK' })).toBe(862);
    expect(await Measurement.countDocuments({ status: 'PM_NOT_REACHABLE' })).toBe(184);
    expect(await Measurement.countDocuments({ status: 'PM_INVALID' })).toBe(154);
    expect(await Measurement.countDocuments({ status: { $ne: 'OK' }, p95: { $ne: null } })).toBe(0);
    expect(await Measurement.countDocuments({ p95: { $gte: 80 } })).toBe(70);
    expect((await Import.findById(imp.id).lean()).status).toBe('successful');
  });

  test('the worked example (NeId 18870, 10/02/2026) is stored with 2192 s above 80 % and P95 = 62.70', async () => {
    await post(fs.readFileSync(REAL), 'congestion_data.xlsx');
    const site = await Site.findOne({ neId: 18870 }).lean();
    expect(site).toMatchObject({ neType: 'AMM 20PB', wilayaCode: 18 });
    const m = await Measurement.findOne({ site: site._id, endTime: new Date('2026-02-10T00:00:00Z') }).lean();
    expect(m.status).toBe('OK');
    expect(m.tailSeconds[16]).toBe(2192);
    expect(m.p95).toBeCloseTo(62.7021, 3);
  });

  test('counts always add up: valid + failed + rejected + skipped = rowsTotal', async () => {
    const c = (await post(fs.readFileSync(REAL), 'congestion_data.xlsx')).body.data.import.counts;
    expect(c.valid + c.failed + c.rejected + c.skipped).toBe(c.rowsTotal);
  });

  test('re-uploading the real file is refused (409) and the data is unchanged', async () => {
    await post(fs.readFileSync(REAL), 'congestion_data.xlsx');
    const before = await counts();
    expect((await post(fs.readFileSync(REAL), 'copy.xlsx')).statusCode).toBe(409);
    expect(await counts()).toEqual(before);
  });
});