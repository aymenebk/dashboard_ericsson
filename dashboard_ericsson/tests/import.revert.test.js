// T12: cancelling (reverting) an import. Real app, real database.
// Own database (DATABASE_TEST + "-revert"), emptied after each test and dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
const mongoose = require('mongoose');
const supertest = require('supertest');
const app = require('../app');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Measurement = require('../models/measurementModel');
const { loginAsAdmin } = require('./helpers/auth');
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, rowInBin, failureRow } = require('./helpers/xlsx');

const MODELS = [Site, Link, Import, ImportIssue, Measurement];
const counts = async () => Object.fromEntries(await Promise.all(MODELS.map(async (M) => [M.modelName, await M.countDocuments()])));
const EMPTY = { Site: 0, Link: 0, Import: 0, ImportIssue: 0, Measurement: 0 };

let token;
const api = (method, url) => supertest(app)[method](url).set('Authorization', `Bearer ${token}`);
const upload = async (rows, name = 'data.xlsx') => api('post', '/api/v1/imports').attach('file', await makeXlsx(rows), name);
const revert = (id) => api('delete', `/api/v1/imports/${id}`);

// The database must never hold a half-deleted state
async function expectConsistent() {
  const [sites, links, measurements] = await Promise.all([Site.find({}, '_id').lean(), Link.find({}, '_id site').lean(), Measurement.find({}, 'site link import').lean()]);
  const siteIds = new Set(sites.map((s) => String(s._id)));
  const linkIds = new Set(links.map((l) => String(l._id)));
  const importIds = new Set((await Import.find({}, '_id').lean()).map((i) => String(i._id)));
  links.forEach((l) => expect(siteIds.has(String(l.site))).toBe(true)); // no link without its site
  measurements.forEach((m) => {
    expect(linkIds.has(String(m.link))).toBe(true); // no measurement without its link
    expect(siteIds.has(String(m.site))).toBe(true);
    expect(importIds.has(String(m.import))).toBe(true); // no measurement without its import
  });
  const usedLinks = new Set(measurements.map((m) => String(m.link)));
  links.forEach((l) => expect(usedLinks.has(String(l._id))).toBe(true)); // no orphan link
  const usedSites = new Set(links.map((l) => String(l.site)));
  sites.forEach((s) => expect(usedSites.has(String(s._id))).toBe(true)); // no orphan site
  (await ImportIssue.find({}, 'import').lean()).forEach((i) => expect(importIds.has(String(i.import))).toBe(true));
}

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-revert`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all(MODELS.map((M) => M.init()));
  token = await loginAsAdmin();
});
afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(MODELS.map((M) => M.deleteMany({})));
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('DELETE /imports/:id', () => {
  test('commit then revert: everything the import created is removed and the status/history follow', async () => {
    const res = await upload([
      rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' }),
      rowInBin(3, { NeId: 16001, MeasurePoint: '1/11/2' }),
      rowInBin(5, { NeId: 17002, NeType: 'AMM 20PB', MeasurePoint: '1/11/3', EndTime: '11/02/2026 00:00:00' }),
      failureRow({ NeId: 18003, MeasurePoint: '1/11/4' }),
    ]);
    expect(res.statusCode).toBe(201);
    const id = res.body.data.import.id;
    expect(await counts()).toMatchObject({ Site: 3, Link: 4, Import: 1, Measurement: 4 });
    expect((await api('get', `/api/v1/imports/${id}`)).statusCode).toBe(200);
    expect((await api('get', '/api/v1/sites')).body.total).toBe(3);

    const del = await revert(id);
    expect(del.statusCode).toBe(200);
    expect(del.body.data.removed).toEqual({ measurements: 4, issues: expect.any(Number), links: 4, sites: 3 });
    expect(await counts()).toEqual(EMPTY);

    // status / history: it is gone everywhere
    expect((await api('get', `/api/v1/imports/${id}`)).statusCode).toBe(404);
    expect((await api('get', `/api/v1/imports/${id}/rows`)).statusCode).toBe(404);
    expect((await api('get', '/api/v1/imports')).body.total).toBe(0);
    expect((await api('get', '/api/v1/sites')).body.total).toBe(0);
    expect((await api('get', '/api/v1/dashboard')).body.data.totals.sites).toBe(0);
  });

  test('reverting a second import keeps what an earlier import brought (shared sites and links stay)', async () => {
    const a = await upload([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: '10/02/2026 00:00:00' })], 'a.xlsx');
    const before = await counts();
    const b = await upload([
      rowInBin(2, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: '11/02/2026 00:00:00' }), // same link, new day
      rowInBin(2, { NeId: 16001, MeasurePoint: '1/11/9', EndTime: '11/02/2026 00:00:00' }), // new link on the same site
      rowInBin(2, { NeId: 17002, MeasurePoint: '1/11/3', EndTime: '11/02/2026 00:00:00' }), // brand-new site
      rowInBin(9, { NeId: 16001, MeasurePoint: '1/11/1', EndTime: '10/02/2026 00:00:00' }), // already imported by A: skipped
    ], 'b.xlsx');
    expect(b.statusCode).toBe(201);
    expect(b.body.data.import.counts.skipped).toBe(1);
    expect(await counts()).toMatchObject({ Site: 2, Link: 3, Measurement: 4 });

    const del = await revert(b.body.data.import.id);
    expect(del.statusCode).toBe(200);
    expect(del.body.data.removed).toMatchObject({ measurements: 3, links: 2, sites: 1 });

    expect(await counts()).toEqual(before); // exactly the state after import A, down to the issue rows
    const kept = await Measurement.findOne({ endTime: new Date('2026-02-10T00:00:00Z') }).lean();
    expect(String(kept.import)).toBe(a.body.data.import.id);
    expect((await api('get', `/api/v1/imports/${a.body.data.import.id}`)).statusCode).toBe(200);
    await expectConsistent();
  });

  test('the same file can be imported again after a revert (the fingerprint is freed)', async () => {
    const file = await makeXlsx([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' })]); // ONE buffer = one fingerprint
    const send = () => api('post', '/api/v1/imports').attach('file', file, 'data.xlsx');
    const first = await send();
    expect((await send()).body.code).toBe('IMPORT_DUPLICATE_FILE'); // refused while it exists
    expect((await revert(first.body.data.import.id)).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(201);
  });

  test('repeated cancellation is safe: the second call is a clean 404 and changes nothing', async () => {
    const keep = await upload([rowInBin(1, { NeId: 19001, MeasurePoint: '1/1/1' })], 'keep.xlsx');
    const gone = await upload([rowInBin(2, { NeId: 19002, MeasurePoint: '1/1/2' })], 'gone.xlsx');
    expect((await revert(gone.body.data.import.id)).statusCode).toBe(200);
    const after = await counts();
    const again = await revert(gone.body.data.import.id);
    expect(again.statusCode).toBe(404);
    expect(again.body).toMatchObject({ status: 'fail', code: 'NOT_FOUND' });
    expect(await counts()).toEqual(after);
    expect((await api('get', `/api/v1/imports/${keep.body.data.import.id}`)).statusCode).toBe(200);
  });

  test('two cancellations at the same time: exactly one does the work, the other is refused cleanly', async () => {
    const res = await upload([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' }), rowInBin(3, { NeId: 17002, MeasurePoint: '1/11/2' })]);
    const id = res.body.data.import.id;
    const [x, y] = await Promise.all([revert(id), revert(id)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, expect.any(Number)]);
    expect([404, 409]).toContain([x.statusCode, y.statusCode].find((c) => c !== 200));
    expect(await counts()).toEqual(EMPTY);
  });

  test('bad ids: 400 for a malformed id, 404 for an unknown one', async () => {
    expect((await revert('not-an-id')).statusCode).toBe(400);
    const unknown = await revert('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(unknown.statusCode).toBe(404);
  });

  test('partial failure: the import stays hidden, a retry is refused while fresh, then resumes and finishes', async () => {
    const res = await upload([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' }), rowInBin(3, { NeId: 17002, MeasurePoint: '1/11/2' })]);
    const id = res.body.data.import.id;

    jest.spyOn(Link, 'deleteMany').mockRejectedValueOnce(new Error('simulated crash: /secret/path/to/db'));
    const failed = await revert(id);
    expect(failed.statusCode).toBe(500);
    expect(failed.body).toMatchObject({ status: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    expect(JSON.stringify(failed.body)).not.toContain('simulated crash'); // internals never reach the client
    expect(JSON.stringify(failed.body)).not.toContain('/secret/path');

    // half-done: measurements are gone, links/sites are still there, the import is hidden as "reverting"
    expect((await Import.findById(id)).status).toBe('reverting');
    expect(await Measurement.countDocuments()).toBe(0);
    expect(await Link.countDocuments()).toBe(2);
    expect((await api('get', `/api/v1/imports/${id}`)).statusCode).toBe(404);
    expect((await api('get', '/api/v1/imports')).body.total).toBe(0);

    // fresh "reverting" state: someone may be working on it right now
    const tooSoon = await revert(id);
    expect(tooSoon.statusCode).toBe(409);
    expect(tooSoon.body.code).toBe('IMPORT_REVERT_IN_PROGRESS');

    // abandoned for a while: the retry resumes where it stopped and finishes
    await Import.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const resumed = await revert(id);
    expect(resumed.statusCode).toBe(200);
    // the interrupted pass had already deleted the measurements: only the orphans are left to remove
    expect(resumed.body.data.removed).toMatchObject({ measurements: 0, links: 2, sites: 2 });
    expect(await counts()).toEqual(EMPTY);
    await expectConsistent();
  });

  test('a revert that was interrupted after deleting the measurements still removes the orphan links and sites', async () => {
    const res = await upload([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' })]);
    const id = res.body.data.import.id;
    jest.spyOn(Link, 'deleteMany').mockRejectedValueOnce(new Error('boom'));
    expect((await revert(id)).statusCode).toBe(500);
    await Import.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    expect((await revert(id)).statusCode).toBe(200);
    expect(await counts()).toEqual(EMPTY);
    await expectConsistent();
  });
});

describe('concurrent imports (duplicate measurement race)', () => {
  test('two different files with the same link-days at the same time: exactly one wins, the loser leaves nothing behind', async () => {
    const rows = [
      rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' }),
      rowInBin(3, { NeId: 17002, MeasurePoint: '1/11/2' }),
      rowInBin(5, { NeId: 18003, MeasurePoint: '1/11/3' }),
    ];
    // two workbooks with different bytes (different fingerprints) but the same measurements
    const [x, y] = await Promise.all([upload(rows, 'x.xlsx'), upload(rows, 'y.xlsx')]);
    const codes = [x.statusCode, y.statusCode].sort();
    expect(codes[0]).toBe(201);
    expect(codes[1]).toBe(409);
    expect(await counts()).toMatchObject({ Site: 3, Link: 3, Import: 1, Measurement: 3 });
    expect(await Import.countDocuments({ status: { $ne: 'successful' } })).toBe(0); // no half-finished import left
    await expectConsistent();
  });
});
