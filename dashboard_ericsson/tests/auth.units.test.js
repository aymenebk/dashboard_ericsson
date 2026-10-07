const jwt = require('jsonwebtoken');
const { signToken, verifyToken } = require('../utils/token');
const { checkEnv } = require('../utils/checkEnv');
const User = require('../models/userModel');

const SECRET = 'unit-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const ID = '0123456789abcdef01234567';
const saved = { ...process.env };
beforeEach(() => { process.env.JWT_SECRET = SECRET; delete process.env.JWT_EXPIRES_IN; });
afterAll(() => { process.env = saved; });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('tokens', () => {
  test('a signed token gives back the user id', () => {
    expect(verifyToken(signToken(ID)).id).toBe(ID);
  });

  test('default life is 1 day; JWT_EXPIRES_IN changes it', () => {
    const p = jwt.decode(signToken(ID));
    expect(p.exp - p.iat).toBe(86400);
    process.env.JWT_EXPIRES_IN = '2h';
    const q = jwt.decode(signToken(ID));
    expect(q.exp - q.iat).toBe(7200);
  });

  test('a tampered token is refused', () => {
    const [h, p, s] = signToken(ID).split('.');
    const forged = `${h}.${b64({ id: 'ffffffffffffffffffffffff', iat: 1, exp: 9999999999 })}.${s}`;
    expect(() => verifyToken(forged)).toThrow();
    expect(() => verifyToken(`${h}.${p}.x${s}`)).toThrow();
  });

  test('a token signed with another secret is refused', () => {
    const other = jwt.sign({ id: ID }, 'another-secret-0123456789-abcdefghijklmnopqrstuvwxyz', { algorithm: 'HS256' });
    expect(() => verifyToken(other)).toThrow();
  });

  test('an expired token is refused', () => {
    const now = Math.floor(Date.now() / 1000);
    const old = jwt.sign({ id: ID, iat: now - 7200, exp: now - 3600 }, SECRET, { algorithm: 'HS256' });
    expect(() => verifyToken(old)).toThrow(/expired/i);
  });

  test('algorithm "none" and other algorithms are refused', () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ id: ID })}.`;
    expect(() => verifyToken(none)).toThrow();
    const hs512 = jwt.sign({ id: ID }, SECRET, { algorithm: 'HS512' });
    expect(() => verifyToken(hs512)).toThrow();
  });

  test('garbage is refused', () => {
    for (const t of ['', 'abc', 'a.b.c', 'null']) expect(() => verifyToken(t)).toThrow();
  });

  test('no secret or a short secret: signing is impossible', () => {
    delete process.env.JWT_SECRET;
    expect(() => signToken(ID)).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = 'too-short';
    expect(() => signToken(ID)).toThrow(/JWT_SECRET/);
  });
});

describe('checkEnv', () => {
  const ok = { DATABASE_LOCAL: 'mongodb://127.0.0.1:27017/x', JWT_SECRET: SECRET };

  test('a complete configuration passes', () => {
    expect(() => checkEnv(ok)).not.toThrow();
    expect(() => checkEnv({ ...ok, JWT_EXPIRES_IN: '12h', RATE_LIMIT_MAX: '300', LOGIN_RATE_MAX: '5' })).not.toThrow();
  });

  test('missing values are named, all at once', () => {
    expect(() => checkEnv({})).toThrow(/DATABASE_LOCAL is missing.*JWT_SECRET is missing/);
  });

  test('a short secret is refused', () => {
    expect(() => checkEnv({ ...ok, JWT_SECRET: 'short' })).toThrow(/at least 32/);
  });

  test.each([['JWT_EXPIRES_IN', '1 day'], ['JWT_EXPIRES_IN', 'abc'], ['RATE_LIMIT_MAX', '0'], ['RATE_LIMIT_MAX', 'abc'], ['LOGIN_RATE_MAX', '-3']])(
    'bad %s=%s is refused', (key, value) => {
      expect(() => checkEnv({ ...ok, [key]: value })).toThrow(new RegExp(key));
    },
  );
});

describe('user validation (no database)', () => {
  const errorPaths = async (doc) => { try { await doc.validate(); return []; } catch (e) { return Object.keys(e.errors); } };
  const good = { email: 'admin@example.com', password: 'a-long-enough-password' };

  test('a valid account; default role is the least privileged one; email is lower-cased and trimmed', async () => {
    const u = new User({ ...good, email: '  Admin@Example.COM ' });
    expect(await errorPaths(u)).toEqual([]);
    expect(u.email).toBe('admin@example.com');
    expect(u.role).toBe('viewer');
    expect(u.active).toBe(true);
  });

  test('bad emails', async () => {
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', '@c.com']) expect(await errorPaths(new User({ ...good, email }))).toContain('email');
  });

  test('password: at least 12 characters', async () => {
    expect(await errorPaths(new User({ ...good, password: '12345678901' }))).toEqual(['password']);
    expect(await errorPaths(new User({ ...good, password: '123456789012' }))).toEqual([]);
  });

  test('password: at most 72 BYTES (bcrypt would silently ignore the rest)', async () => {
    expect(await errorPaths(new User({ ...good, password: 'a'.repeat(72) }))).toEqual([]);
    expect(await errorPaths(new User({ ...good, password: 'a'.repeat(73) }))).toEqual(['password']);
    expect(await errorPaths(new User({ ...good, password: 'é'.repeat(40) }))).toEqual(['password']); // 40 characters but 80 bytes
  });

  test('role must be admin or viewer; email and password are required', async () => {
    expect(await errorPaths(new User({ ...good, role: 'root' }))).toEqual(['role']);
    expect(await errorPaths(new User({}))).toEqual(expect.arrayContaining(['email', 'password']));
  });
});