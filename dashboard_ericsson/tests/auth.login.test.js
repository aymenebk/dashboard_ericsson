// Login and "who am I" against the real app and a REAL database.
// Own database (DATABASE_TEST + "-auth"), dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
const SECRET = 'login-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.JWT_SECRET = SECRET;
process.env.BCRYPT_COST = '4'; // fast hashing for tests only
process.env.LOGIN_RATE_MAX = '1000'; // this file makes many failed logins on purpose; throttling is tested in security.test.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const User = require('../models/userModel');
const { signToken, verifyToken } = require('../utils/token');
const { DUMMY_HASH } = require('../controllers/authController');
const { testConnectOptions } = require('./helpers/dbConnect');

const PASSWORD = 'a-long-enough-password';
const login = (body) => request(app).post('/api/v1/auth/login').send(body);
const me = (token, scheme = 'Bearer') => request(app).get('/api/v1/auth/me').set('Authorization', `${scheme} ${token}`);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

let admin;
beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-auth`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await User.init();
});
beforeEach(async () => { admin = await User.create({ email: 'admin@example.com', password: PASSWORD, role: 'admin' }); });
afterEach(async () => { if (mongoose.connection.readyState === 1) await User.deleteMany({}); });
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('POST /api/v1/auth/login', () => {
  test('right credentials: 200, a token for this user, and no password in the answer', async () => {
    const res = await login({ email: 'admin@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
    expect(verifyToken(res.body.token).id).toBe(String(admin._id));
    expect(res.body.data.user).toEqual({ id: String(admin._id), email: 'admin@example.com', role: 'admin' });
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$|a-long-enough-password/);
  });

  test('the email is case-insensitive and trimmed; the password is not', async () => {
    expect((await login({ email: '  ADMIN@Example.com ', password: PASSWORD })).statusCode).toBe(200);
    expect((await login({ email: 'admin@example.com', password: PASSWORD.toUpperCase() })).statusCode).toBe(401);
  });

  test('wrong password and unknown email give the SAME answer (no way to tell which accounts exist)', async () => {
    const wrong = await login({ email: 'admin@example.com', password: 'another-long-password' });
    const unknown = await login({ email: 'nobody@example.com', password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    // requestId is unique per request by design; everything else must be identical
    const { requestId: _a, ...unknownBody } = unknown.body;
    const { requestId: _b, ...wrongBody } = wrong.body;
    expect(unknownBody).toEqual(wrongBody);
    expect(wrong.body.message).toBe('Incorrect email or password');
  });

  test('the dummy hash used for unknown emails is a real bcrypt hash (same work as a real check)', () => {
    expect(bcrypt.getRounds(DUMMY_HASH)).toBe(12);
  });

  test('a disabled account cannot log in, even with the right password', async () => {
    await User.updateOne({ _id: admin._id }, { active: false });
    expect((await login({ email: 'admin@example.com', password: PASSWORD })).statusCode).toBe(401);
  });

  test.each([
    [{}], [{ email: 'admin@example.com' }], [{ password: PASSWORD }], [{ email: '', password: PASSWORD }],
    [{ email: '   ', password: PASSWORD }], [{ email: 'admin@example.com', password: '' }],
  ])('missing or empty field %j: 400', async (body) => {
    expect((await login(body)).statusCode).toBe(400);
  });

  test('query operators in the body are refused (NoSQL injection): 400, never a login', async () => {
    for (const body of [
      { email: { $gt: '' }, password: PASSWORD },
      { email: 'admin@example.com', password: { $ne: null } },
      { email: ['admin@example.com'], password: PASSWORD },
      { email: 'admin@example.com', password: 12345 },
    ]) {
      const res = await login(body);
      expect(res.statusCode).toBe(400);
      expect(res.body.token).toBeUndefined();
    }
  });

  test('a broken JSON body is a 400, not a server error', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.statusCode).toBe(400);
  });

  test('no body at all: 400', async () => {
    expect((await request(app).post('/api/v1/auth/login')).statusCode).toBe(400);
  });
});

describe('GET /api/v1/auth/me (the token check used by every protected route)', () => {
  test('a good token: 200 and the user', async () => {
    const res = await me(signToken(admin._id));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user).toEqual({ id: String(admin._id), email: 'admin@example.com', role: 'admin' });
  });

  test('the token returned by login works', async () => {
    const { token } = (await login({ email: 'admin@example.com', password: PASSWORD })).body;
    expect((await me(token)).statusCode).toBe(200);
  });

  test('no header, wrong scheme, empty or garbage token: 401', async () => {
    expect((await request(app).get('/api/v1/auth/me')).statusCode).toBe(401);
    expect((await me(signToken(admin._id), 'Basic')).statusCode).toBe(401);
    expect((await me('')).statusCode).toBe(401);
    expect((await me('garbage')).statusCode).toBe(401);
  });

  test('expired token, token of another secret, tampered token, algorithm "none": 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const id = String(admin._id);
    const expired = jwt.sign({ id, iat: now - 7200, exp: now - 3600 }, SECRET, { algorithm: 'HS256' });
    const otherSecret = jwt.sign({ id }, 'another-secret-0123456789-abcdefghijklmnopqrstuvwxyz', { algorithm: 'HS256' });
    const [h, , s] = signToken(id).split('.');
    const tampered = `${h}.${b64({ id: String(new mongoose.Types.ObjectId()), iat: now, exp: now + 3600 })}.${s}`;
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id })}.`;
    for (const t of [expired, otherSecret, tampered, none]) expect((await me(t)).statusCode).toBe(401);
  });

  test('a valid token whose account was deleted or disabled: 401', async () => {
    const token = signToken(admin._id);
    await User.updateOne({ _id: admin._id }, { active: false });
    expect((await me(token)).statusCode).toBe(401);
    await User.deleteOne({ _id: admin._id });
    expect((await me(token)).statusCode).toBe(401);
  });

  test('a token issued BEFORE a password change stops working; a new one works', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = jwt.sign({ id: String(admin._id), iat: now - 120, exp: now + 3600 }, SECRET, { algorithm: 'HS256' });
    expect((await me(old)).statusCode).toBe(200);
    const u = await User.findById(admin._id).select('+password');
    u.password = 'a-brand-new-password';
    await u.save();
    expect((await me(old)).statusCode).toBe(401);
    expect((await me(signToken(admin._id))).statusCode).toBe(200);
  });

  test('a token whose id is not a valid id: 401', async () => {
    expect((await me(jwt.sign({ id: 'not-an-id' }, SECRET, { algorithm: 'HS256' }))).statusCode).toBe(401);
  });

  test('a viewer can use it too', async () => {
    const viewer = await User.create({ email: 'viewer@example.com', password: PASSWORD });
    const res = await me(signToken(viewer._id));
    expect(res.body.data.user.role).toBe('viewer');
  });
});