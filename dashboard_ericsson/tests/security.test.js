// T11.4: security headers, CORS, rate limiting, upload limits, token handling and the shape of errors.
// Own database (DATABASE_TEST + "-security"), dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
process.env.JWT_SECRET = 'security-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.BCRYPT_COST = '4';
const mongoose = require('mongoose');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const User = require('../models/userModel');
const Import = require('../models/importModel');
const Site = require('../models/siteModel');
const { signToken } = require('../utils/token');
const { MAX_BYTES } = require('../utils/upload');
const { testConnectOptions } = require('./helpers/dbConnect');
const { makeXlsx, rowInBin } = require('./helpers/xlsx');

const PASSWORD = 'a-long-enough-password';
let adminToken; let viewerToken;

beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-security`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await Promise.all([User.init(), Import.init(), Site.init()]);
  const admin = await User.create({ email: 'admin@example.com', password: PASSWORD, role: 'admin' });
  const viewer = await User.create({ email: 'viewer@example.com', password: PASSWORD, role: 'viewer' });
  adminToken = signToken(admin._id);
  viewerToken = signToken(viewer._id);
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('authentication errors carry a precise code', () => {
  test('no token: 401 TOKEN_MISSING', async () => {
    const res = await supertest(app).get('/api/v1/sites');
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ status: 'fail', code: 'TOKEN_MISSING' });
  });

  test('garbage token: 401 TOKEN_INVALID', async () => {
    const res = await supertest(app).get('/api/v1/sites').set(auth('not.a.jwt'));
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  test('expired token: 401 TOKEN_EXPIRED', async () => {
    const user = await User.findOne({ email: 'admin@example.com' });
    const expired = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -10 });
    const res = await supertest(app).get('/api/v1/sites').set(auth(expired));
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  test('token signed with another secret, and an unsigned "alg none" token: 401', async () => {
    const user = await User.findOne({ email: 'admin@example.com' });
    const foreign = jwt.sign({ id: String(user._id) }, 'another-secret-0123456789-abcdefghijklmnopqrstuvwxyz');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ id: String(user._id) })).toString('base64url')}.`;
    expect((await supertest(app).get('/api/v1/sites').set(auth(foreign))).statusCode).toBe(401);
    expect((await supertest(app).get('/api/v1/sites').set(auth(none))).statusCode).toBe(401);
  });

  test('a valid token is accepted', async () => {
    expect((await supertest(app).get('/api/v1/sites').set(auth(viewerToken))).statusCode).toBe(200);
  });

  test('a viewer is refused (403 FORBIDDEN) on every admin-only route, an admin is let through', async () => {
    const viewerDelete = await supertest(app).delete('/api/v1/imports/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(viewerToken));
    expect(viewerDelete.statusCode).toBe(403);
    expect(viewerDelete.body.code).toBe('FORBIDDEN');
    const viewerPost = await supertest(app).post('/api/v1/imports').set(auth(viewerToken));
    expect(viewerPost.statusCode).toBe(403);
    // an admin passes authorization (and then gets a 404: that import does not exist)
    expect((await supertest(app).delete('/api/v1/imports/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(adminToken))).statusCode).toBe(404);
  });

  test('DELETE /imports/:id without a token: 401, nothing is touched', async () => {
    expect((await supertest(app).delete('/api/v1/imports/aaaaaaaaaaaaaaaaaaaaaaaa')).statusCode).toBe(401);
  });
});

describe('HTTP hardening', () => {
  test('security headers are set and the framework is not advertised', async () => {
    const res = await supertest(app).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('every response has a request id, and an error body repeats it', async () => {
    const res = await supertest(app).get('/api/v1/sites');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  test('CORS: with CORS_ORIGIN unset no CORS header is sent', async () => {
    const res = await supertest(app).get('/api/v1/health').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('CORS: only the listed origin is allowed', () => {
    let isolated;
    jest.isolateModules(() => {
      process.env.CORS_ORIGIN = 'http://localhost:5173';
      isolated = require('../app');
    });
    delete process.env.CORS_ORIGIN;
    return supertest(isolated).get('/api/v1/health').set('Origin', 'http://localhost:5173').then(async (ok) => {
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(ok.headers['access-control-expose-headers']).toContain('Retry-After'); // the browser may read it after a 429
      const bad = await supertest(isolated).get('/api/v1/health').set('Origin', 'http://evil.example');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await supertest(isolated).options('/api/v1/imports')
        .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'DELETE');
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-methods']).toContain('DELETE');
    });
  });

  test('malformed JSON is a 400 with a clean body, not a crash', async () => {
    const res = await supertest(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ status: 'fail', code: 'MALFORMED_JSON' });
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at .*\.js|node_modules/);
  });

  test('a JSON body above 10 kb is refused with 413', async () => {
    const res = await supertest(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x'.repeat(20000) });
    expect(res.statusCode).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('hostile query values never crash the server', async () => {
    const urls = [
      '/api/v1/sites?neId[$gt]=1', '/api/v1/sites?neId=%00', '/api/v1/sites?sort[]=a&sort[]=b', '/api/v1/sites?page=-1',
      '/api/v1/sites?limit=99999999999999999999', '/api/v1/sites?condition=%7B%22%24ne%22%3Anull%7D', '/api/v1/sites?wilaya=1e3',
      '/api/v1/dashboard?date=2026-13-45', '/api/v1/dashboard?import[$ne]=x', '/api/v1/sites/%24ne', '/api/v1/sites/..%2F..%2Fetc%2Fpasswd',
      '/api/v1/imports/not-an-id/rows', '/api/v1/imports/aaaaaaaaaaaaaaaaaaaaaaaa/rows?q=(.*)*&filter[]=x',
      '/api/v1/imports/aaaaaaaaaaaaaaaaaaaaaaaa/issues?code[$regex]=.*',
    ];
    for (const url of urls) {
      const res = await supertest(app).get(url).set(auth(viewerToken));
      // Express 5 ignores bracket keys such as neId[$gt] (no operator ever reaches a query): 200 is fine there
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode >= 400) expect(res.body.code).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/CastError|MongoServerError|BSON|node_modules|\.js:\d+/);
    }
  });

  test('a path-traversal style import id is refused before the database is touched', async () => {
    const res = await supertest(app).delete('/api/v1/imports/..%2F..%2Fx').set(auth(adminToken));
    expect(res.statusCode).toBe(400);
  });
});

describe('upload limits', () => {
  const upload = (buffer, name, token = adminToken) => supertest(app).post('/api/v1/imports').set(auth(token)).attach('file', buffer, name);

  test('the limit is 10 MB', () => expect(MAX_BYTES).toBe(10 * 1024 * 1024));

  test('a file above the limit: 413 FILE_TOO_LARGE, nothing stored', async () => {
    const res = await upload(Buffer.alloc(MAX_BYTES + 1024, 1), 'big.xlsx');
    expect(res.statusCode).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(await Import.countDocuments()).toBe(0);
  });

  test('a disallowed extension: 415 UNSUPPORTED_FILE_TYPE', async () => {
    const res = await upload(Buffer.from('MZ...'), 'malware.exe');
    expect(res.statusCode).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  test('a file named .xlsx that is not a workbook: 422 and nothing is left in the database', async () => {
    const res = await upload(Buffer.from('this is not a zip file'), 'fake.xlsx');
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('EXCEL_UNREADABLE');
    expect(await Import.countDocuments()).toBe(0);
  });

  test('no file: 400 UPLOAD_MISSING; two files: 400', async () => {
    const none = await supertest(app).post('/api/v1/imports').set(auth(adminToken));
    expect(none.statusCode).toBe(400);
    expect(none.body.code).toBe('UPLOAD_MISSING');
    const file = await makeXlsx([rowInBin(1)]);
    const two = await supertest(app).post('/api/v1/imports').set(auth(adminToken)).attach('file', file, 'a.xlsx').attach('file', file, 'b.xlsx');
    expect(two.statusCode).toBe(400);
  });

  test('a path in the file name cannot reach the file system (the file only ever lives in memory)', async () => {
    const file = await makeXlsx([rowInBin(1, { NeId: 31001, MeasurePoint: '1/1/1' })]);
    const res = await upload(file, '../../etc/evil.xlsx');
    expect(res.statusCode).toBe(201);
    expect(res.body.data.import.fileName).not.toMatch(/\.\.[\\/]/);
    await Import.deleteMany({});
  });

  test('a workbook with missing columns: 422 EXCEL_MISSING_COLUMNS listing them', async () => {
    const file = await makeXlsx([{ NeId: 1 }], ['NeId', 'NeType']);
    const res = await upload(file, 'partial.xlsx');
    expect(res.statusCode).toBe(422);
    expect(res.body.code).toBe('EXCEL_MISSING_COLUMNS');
    expect(res.body.details.missing).toContain('MeasurePoint');
  });
});

describe('rate limiting', () => {
  // A second copy of the app (and of mongoose) built with other limits. Its own mongoose must be connected too.
  const opened = [];
  const freshApp = async (env, { connect = false } = {}) => {
    let isolated;
    let isolatedMongoose;
    const saved = {};
    Object.keys(env).forEach((k) => { saved[k] = process.env[k]; process.env[k] = env[k]; });
    jest.isolateModules(() => {
      isolated = require('../app');
      isolatedMongoose = require('mongoose');
    });
    Object.keys(env).forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
    if (connect) {
      await isolatedMongoose.connect(`${process.env.DATABASE_TEST}-security`, testConnectOptions);
      opened.push(isolatedMongoose);
    }
    return isolated;
  };
  afterAll(async () => { await Promise.all(opened.map((m) => m.connection.close())); });

  test('the whole API: request number N+1 is a 429 RATE_LIMITED, with a Retry-After; /health is never limited', async () => {
    const limited = await freshApp({ RATE_LIMIT_MAX: '3' });
    for (let i = 0; i < 3; i += 1) expect((await supertest(limited).get('/api/v1/sites')).statusCode).toBe(401);
    const res = await supertest(limited).get('/api/v1/sites');
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ status: 'fail', code: 'RATE_LIMITED' });
    expect(res.headers['retry-after']).toBeDefined();
    for (let i = 0; i < 6; i += 1) expect((await supertest(limited).get('/api/v1/health')).statusCode).toBe(200);
  });

  test('login: only FAILED attempts count; after LOGIN_RATE_MAX failures even the right password is refused', async () => {
    const limited = await freshApp({ LOGIN_RATE_MAX: '3', RATE_LIMIT_MAX: '1000' }, { connect: true });
    const login = (password) => supertest(limited).post('/api/v1/auth/login').send({ email: 'admin@example.com', password });
    // successful logins never use the budget
    for (let i = 0; i < 5; i += 1) expect((await login(PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < 3; i += 1) expect((await login('wrong-password-123')).statusCode).toBe(401);
    const blocked = await login(PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });
});
