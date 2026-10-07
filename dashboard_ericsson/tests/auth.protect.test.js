// Every route except health and login needs a token; importing needs the admin role.
// Own database (DATABASE_TEST + "-protect"), dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
process.env.JWT_SECRET = 'protect-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.BCRYPT_COST = '4'; // fast hashing for tests only
const mongoose = require('mongoose');
const supertest = require('supertest');
const app = require('../app');
const User = require('../models/userModel');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Measurement = require('../models/measurementModel');
const { signToken } = require('../utils/token');
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, rowInBin } = require('./helpers/xlsx');

const PASSWORD = 'a-long-enough-password';
const DATA = [Site, Link, Import, ImportIssue, Measurement];
const call = (method, url, token) => {
  const req = supertest(app)[method](url);
  return token === undefined ? req : req.set('Authorization', `Bearer ${token}`);
};
const counts = async () => Object.fromEntries(await Promise.all(DATA.map(async (M) => [M.modelName, await M.countDocuments()])));

let admin; let viewer; let adminToken; let viewerToken; const ids = {};
beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-protect`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all([User, ...DATA].map((M) => M.init()));
  admin = await User.create({ email: 'admin@example.com', password: PASSWORD, role: 'admin' });
  viewer = await User.create({ email: 'viewer@example.com', password: PASSWORD, role: 'viewer' });
  adminToken = signToken(admin._id);
  viewerToken = signToken(viewer._id);
  // one small import so that every route has something to show
  const file = await makeXlsx([rowInBin(17, { NeId: 16001, MeasurePoint: '1/11/1' })]);
  const res = await supertest(app).post('/api/v1/imports').set('Authorization', `Bearer ${adminToken}`).attach('file', file, 'data.xlsx');
  expect(res.statusCode).toBe(201);
  ids.import = res.body.data.import.id;
  ids.site = String((await Site.findOne({ neId: 16001 }))._id);
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

const PROTECTED = [
  ['get', '/api/v1/imports'], ['get', () => `/api/v1/imports/${ids.import}`], ['get', () => `/api/v1/imports/${ids.import}/rows`],
  ['get', () => `/api/v1/imports/${ids.import}/issues`], ['get', '/api/v1/dashboard'], ['get', '/api/v1/wilayas'],
  ['get', '/api/v1/sites'], ['get', () => `/api/v1/sites/${ids.site}`], ['get', '/api/v1/auth/me'],
];
const urlOf = (u) => (typeof u === 'function' ? u() : u);

describe('public routes stay public', () => {
  test('health answers without a token', async () => {
    expect((await call('get', '/api/v1/health')).statusCode).toBe(200);
  });
  test('login is reachable without a token (it answers 400 to an empty body, not 401)', async () => {
    expect((await call('post', '/api/v1/auth/login')).statusCode).toBe(400);
  });
  test('an unknown route is a 404 even without a token', async () => {
    const res = await call('get', '/api/v1/nothing-here');
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain('/api/v1/nothing-here');
  });
});

describe('protected routes', () => {
  test.each(PROTECTED)('%s %s: 401 without a token, with a garbage token, with a wrong scheme', async (method, url) => {
    expect((await call(method, urlOf(url))).statusCode).toBe(401);
    expect((await call(method, urlOf(url), 'garbage')).statusCode).toBe(401);
    const basic = await supertest(app)[method](urlOf(url)).set('Authorization', `Basic ${adminToken}`);
    expect(basic.statusCode).toBe(401);
  });

  test.each(PROTECTED)('%s %s: 200 with an admin token and with a viewer token', async (method, url) => {
    expect((await call(method, urlOf(url), adminToken)).statusCode).toBe(200);
    expect((await call(method, urlOf(url), viewerToken)).statusCode).toBe(200);
  });

  test('a refused request reveals nothing: only the status and a message', async () => {
    const res = await call('get', '/api/v1/sites');
    expect(Object.keys(res.body).sort()).toEqual(expect.arrayContaining(['message', 'status']));
    expect(res.body.data).toBeUndefined();
  });

  test('POST /imports without a token: 401 and the file is not even processed', async () => {
    const before = await counts();
    const file = await makeXlsx([rowInBin(12, { NeId: 7001, MeasurePoint: '1/11/2' })]);
    const res = await supertest(app).post('/api/v1/imports').attach('file', file, 'x.xlsx');
    expect(res.statusCode).toBe(401);
    expect(await counts()).toEqual(before);
  });
});

describe('roles: only an admin can import', () => {
  test('a viewer gets 403 on POST /imports and nothing is stored', async () => {
    const before = await counts();
    const file = await makeXlsx([rowInBin(12, { NeId: 7002, MeasurePoint: '1/11/3' })]);
    const res = await supertest(app).post('/api/v1/imports').set('Authorization', `Bearer ${viewerToken}`).attach('file', file, 'x.xlsx');
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('You do not have permission to perform this action');
    expect(await counts()).toEqual(before);
  });

  test('an admin can import', async () => {
    const file = await makeXlsx([rowInBin(12, { NeId: 7003, MeasurePoint: '1/11/4' })]);
    const res = await supertest(app).post('/api/v1/imports').set('Authorization', `Bearer ${adminToken}`).attach('file', file, 'y.xlsx');
    expect(res.statusCode).toBe(201);
  });

  test('a viewer who is promoted to admin can import with the SAME token (the role is read from the database)', async () => {
    const promoted = await User.create({ email: 'promoted@example.com', password: PASSWORD, role: 'viewer' });
    const token = signToken(promoted._id);
    const file = await makeXlsx([rowInBin(12, { NeId: 7004, MeasurePoint: '1/11/5' })]);
    const upload = () => supertest(app).post('/api/v1/imports').set('Authorization', `Bearer ${token}`).attach('file', file, 'z.xlsx');
    expect((await upload()).statusCode).toBe(403);
    await User.updateOne({ _id: promoted._id }, { role: 'admin' });
    expect((await upload()).statusCode).toBe(201);
  });
});

describe('a token stops working when its account changes', () => {
  test('disabled or deleted account: 401 on a data route', async () => {
    const u = await User.create({ email: 'temp@example.com', password: PASSWORD, role: 'admin' });
    const token = signToken(u._id);
    expect((await call('get', '/api/v1/dashboard', token)).statusCode).toBe(200);
    await User.updateOne({ _id: u._id }, { active: false });
    expect((await call('get', '/api/v1/dashboard', token)).statusCode).toBe(401);
    await User.deleteOne({ _id: u._id });
    expect((await call('get', '/api/v1/dashboard', token)).statusCode).toBe(401);
  });

  test('password changed after the token was issued: 401 on a data route', async () => {
    const jwt = require('jsonwebtoken');
    const u = await User.create({ email: 'rotate@example.com', password: PASSWORD, role: 'admin' });
    const now = Math.floor(Date.now() / 1000);
    const old = jwt.sign({ id: String(u._id), iat: now - 120, exp: now + 3600 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    expect((await call('get', '/api/v1/sites', old)).statusCode).toBe(200);
    const doc = await User.findById(u._id).select('+password');
    doc.password = 'a-brand-new-password';
    await doc.save();
    expect((await call('get', '/api/v1/sites', old)).statusCode).toBe(401);
  });
});