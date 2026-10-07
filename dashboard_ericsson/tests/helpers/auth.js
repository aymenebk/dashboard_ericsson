// Test helper: the API needs a token. `request(app)` works like supertest's, but every call
// carries the token of a test administrator created by loginAsAdmin().
const supertest = require('supertest');

// Fixed test settings (cost 4 keeps password hashing fast in tests; NEVER use it in production)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'jest-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
}
process.env.BCRYPT_COST = '4';

const User = require('../../models/userModel');
const { signToken } = require('../../utils/token');

let adminToken = null;

exports.loginAsAdmin = async () => {
  await User.init();
  await User.deleteMany({ email: 'admin@test.local' });
  const admin = await User.create({ email: 'admin@test.local', password: 'Test-password-123', role: 'admin' });
  adminToken = signToken(admin._id);
  return adminToken;
};

exports.request = (app) => {
  const agent = supertest(app);
  const withToken = (method) => (url) => agent[method](url).set('Authorization', `Bearer ${adminToken}`);
  return {
    get: withToken('get'), post: withToken('post'), put: withToken('put'),
    patch: withToken('patch'), delete: withToken('delete'),
    
  };
};