// Tests against a REAL MongoDB: they check that the unique indexes really refuse duplicates.
// They use their own database (DATABASE_TEST + "-models"), dropped at the end.
require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const { testConnectOptions } = require('./helpers/dbConnect');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const Measurement = require('../models/measurementModel');
const { computeMetrics } = require('../utils/calc/saturation');

const BINS_18870 = [50948, 16487, 5770, 2966, 584, 967, 895, 507, 677, 584,
  543, 898, 470, 650, 636, 626, 575, 432, 701, 484];
const DAY1 = new Date('2026-02-10T00:00:00Z');
const DAY2 = new Date('2026-02-11T00:00:00Z');
const id = () => new mongoose.Types.ObjectId();

const importDoc = (over = {}) => ({
  fileName: 'congestion_data.xlsx', fileType: 'xlsx', fileSize: 1000, sha256: 'a'.repeat(64), ...over,
});
const measurementDoc = (link, endTime, over = {}) => {
  const m = computeMetrics(BINS_18870);
  return {
    import: id(), sourceRow: 2, site: id(), link, endTime, status: 'OK', bins: BINS_18870,
    totalSeconds: m.totalSeconds, tailSeconds: m.tailSeconds, meanUtil: m.meanUtil, p95: m.p95, ...over,
  };
};

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-models`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
    await mongoose.connect(uri, testConnectOptions);
  await Promise.all([Site.init(), Link.init(), Import.init(), Measurement.init()]); // build indexes
});

afterEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([Site.deleteMany({}), Link.deleteMany({}), Import.deleteMany({}), Measurement.deleteMany({})]);
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('unique indexes on a real database', () => {
  test('Site: same (neId, neType) is refused, same neId with another type is allowed', async () => {
    await Site.create({ neId: 18870, neType: 'AMM 20PB', wilayaCode: 18 });
    await expect(Site.create({ neId: 18870, neType: 'AMM 20PB', wilayaCode: 18 })).rejects.toMatchObject({ code: 11000 });
    await expect(Site.create({ neId: 18870, neType: 'SIU 02', wilayaCode: 18 })).resolves.toBeDefined();
    expect(await Site.countDocuments()).toBe(2);
  });

  test('Link: same (site, measurePoint) is refused, same measurePoint on another site is allowed', async () => {
    const [s1, s2] = [id(), id()];
    await Link.create({ site: s1, measurePoint: '1/11/104' });
    await expect(Link.create({ site: s1, measurePoint: '1/11/104' })).rejects.toMatchObject({ code: 11000 });
    await expect(Link.create({ site: s2, measurePoint: '1/11/104' })).resolves.toBeDefined();
  });

  test('Measurement: same (link, endTime) is refused, same link on another day is allowed', async () => {
    const link = id();
    await Measurement.create(measurementDoc(link, DAY1));
    await expect(Measurement.create(measurementDoc(link, DAY1))).rejects.toMatchObject({ code: 11000 });
    await expect(Measurement.create(measurementDoc(link, DAY2))).resolves.toBeDefined();
    expect(await Measurement.countDocuments()).toBe(2);
  });

  test('Import: the same sha256 cannot be stored twice', async () => {
    await Import.create(importDoc());
    await expect(Import.create(importDoc({ fileName: 'copy.xlsx' }))).rejects.toMatchObject({ code: 11000 });
    await expect(Import.create(importDoc({ sha256: 'b'.repeat(64) }))).resolves.toBeDefined();
  });

  test('the indexes really exist in MongoDB', async () => {
    const byName = async (Model) => (await Model.collection.indexes()).reduce((a, i) => ({ ...a, [i.name]: i }), {});
    expect((await byName(Site)).neId_1_neType_1.unique).toBe(true);
    expect((await byName(Link)).site_1_measurePoint_1.unique).toBe(true);
    expect((await byName(Import)).sha256_1.unique).toBe(true);
    expect((await byName(Measurement)).link_1_endTime_1.unique).toBe(true);
  });
});

describe('round trip', () => {
  test('a measured row comes back identical', async () => {
    const link = id();
    await Measurement.create(measurementDoc(link, DAY1));
    const back = await Measurement.findOne({ link }).lean();
    expect(back.bins).toEqual(BINS_18870);
    expect(back.tailSeconds[16]).toBe(2192);
    expect(back.p95).toBeCloseTo(62.7021, 3);
    expect(back.endTime.toISOString()).toBe('2026-02-10T00:00:00.000Z');
  });

  test('a failure row is stored without any result', async () => {
    const link = id();
    await Measurement.create({
      import: id(), sourceRow: 3, site: id(), link, endTime: DAY1, status: 'PM_NOT_REACHABLE',
      failure: 'PM Failure - NE not reachable', bins: new Array(20).fill(0),
    });
    const back = await Measurement.findOne({ link }).lean();
    expect(back.p95).toBeNull();
    expect(back.totalSeconds).toBeNull();
    expect(back.tailSeconds).toBeUndefined();
  });

  test('a failure row with results is refused by the database layer too', async () => {
    await expect(Measurement.create({
      import: id(), sourceRow: 3, site: id(), link: id(), endTime: DAY1, status: 'PM_INVALID',
      bins: new Array(20).fill(0), p95: 0,
    })).rejects.toThrow(/must not carry results/);
  });
});