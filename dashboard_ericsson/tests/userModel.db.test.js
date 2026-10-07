// User model against a REAL database: hashing, hidden password, unique email, password-change marker.
// Own database (DATABASE_TEST + "-users"), dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
process.env.BCRYPT_COST = '4'; // fast hashing for tests only: never use 4 in production
const mongoose = require('mongoose');
const User = require('../models/userModel');
const { testConnectOptions } = require('./helpers/dbConnect');

const PASSWORD = 'a-long-enough-password';
const make = (over = {}) => User.create({ email: 'admin@example.com', password: PASSWORD, role: 'admin', ...over });

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-users`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await User.init();
});
afterEach(async () => { if (mongoose.connection.readyState === 1) await User.deleteMany({}); });
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('User model on a real database', () => {
  test('the password is stored as a bcrypt hash, never in clear', async () => {
    await make();
    const stored = await User.findOne({ email: 'admin@example.com' }).select('+password').lean();
    expect(stored.password).not.toBe(PASSWORD);
    expect(stored.password).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  });

  test('queries do not return the password unless it is asked for', async () => {
    await make();
    expect((await User.findOne({ email: 'admin@example.com' })).password).toBeUndefined();
    expect((await User.findOne({ email: 'admin@example.com' }).select('+password')).password).toBeDefined();
    const json = (await User.findOne({ email: 'admin@example.com' })).toJSON();
    expect(json.password).toBeUndefined();
  });

  test('correctPassword: right password true, wrong or empty false', async () => {
    await make();
    const u = await User.findOne({ email: 'admin@example.com' }).select('+password');
    expect(await u.correctPassword(PASSWORD)).toBe(true);
    expect(await u.correctPassword('another-long-password')).toBe(false);
    expect(await u.correctPassword('')).toBe(false);
  });

  test('two accounts with the same password get different hashes (salt)', async () => {
    await make({ email: 'a@example.com' });
    await make({ email: 'b@example.com' });
    const [a, b] = await User.find().select('+password').sort({ email: 1 }).lean();
    expect(a.password).not.toBe(b.password);
  });

  test('the email is unique, whatever its case', async () => {
    await make();
    await expect(make({ email: 'ADMIN@example.com' })).rejects.toMatchObject({ code: 11000 });
  });

  test('a weak password is refused and nothing is stored', async () => {
    await expect(make({ password: 'short' })).rejects.toThrow(/at least 12/);
    expect(await User.countDocuments()).toBe(0);
  });

  test('a new account has no password-change marker', async () => {
    const u = await make();
    expect(u.passwordChangedAt).toBeUndefined();
    expect(u.changedPasswordAfter(Math.floor(Date.now() / 1000) - 3600)).toBe(false);
  });

  test('changing the password hashes it again and invalidates older tokens', async () => {
    await make();
    const issuedAt = Math.floor(Date.now() / 1000) - 120; // a token issued two minutes ago
    const u = await User.findOne({ email: 'admin@example.com' }).select('+password');
    const oldHash = u.password;
    u.password = 'a-brand-new-password';
    await u.save();

    const after = await User.findOne({ email: 'admin@example.com' }).select('+password');
    expect(after.password).not.toBe(oldHash);
    expect(await after.correctPassword('a-brand-new-password')).toBe(true);
    expect(await after.correctPassword(PASSWORD)).toBe(false);
    expect(after.changedPasswordAfter(issuedAt)).toBe(true); // the old token is refused
    expect(after.changedPasswordAfter(Math.floor(Date.now() / 1000) + 5)).toBe(false); // a token issued later is fine
  });

  test('saving other fields does not hash the hash again', async () => {
    await make();
    const u = await User.findOne({ email: 'admin@example.com' }).select('+password');
    const hash = u.password;
    u.active = false;
    await u.save();
    const after = await User.findOne({ email: 'admin@example.com' }).select('+password');
    expect(after.password).toBe(hash);
    expect(after.active).toBe(false);
    expect(await after.correctPassword(PASSWORD)).toBe(true);
  });

  test('an account loaded WITHOUT its password can still be updated', async () => {
    await make();
    const u = await User.findOne({ email: 'admin@example.com' });
    u.active = false;
    await expect(u.save()).resolves.toBeDefined();
    expect((await User.findOne({ email: 'admin@example.com' })).active).toBe(false);
  });
});