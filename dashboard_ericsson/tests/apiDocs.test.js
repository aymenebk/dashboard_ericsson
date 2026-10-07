// T12: docs/openapi.yaml must describe the API that really exists.
// Own database (DATABASE_TEST + "-docs"), dropped at the end.
require('dotenv').config({ path: './config.env', quiet: true });
process.env.JWT_SECRET = 'docs-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
process.env.BCRYPT_COST = '4';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mongoose = require('mongoose');
const supertest = require('supertest');
const app = require('../app');
const User = require('../models/userModel');
const { signToken } = require('../utils/token');
const { testConnectOptions } = require('./helpers/dbConnect');

const ROOT = path.join(__dirname, '..');
const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'docs', 'openapi.yaml'), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const operations = Object.entries(doc.paths).flatMap(([route, item]) => METHODS.filter((m) => item[m]).map((m) => ({ method: m, route, op: item[m] })));

let adminToken;
beforeAll(async () => {
  const uri = `${process.env.DATABASE_TEST}-docs`;
  if (!uri.includes('test')) throw new Error('Refusing to run on a database whose name does not contain "test"');
  await mongoose.connect(uri, testConnectOptions);
  await User.init();
  adminToken = signToken((await User.create({ email: 'admin@example.com', password: 'a-long-enough-password', role: 'admin' }))._id);
});
afterAll(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});

describe('openapi.yaml', () => {
  test('is a valid OpenAPI 3 document with security, servers and an Error schema', () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.servers[0].url).toBe('http://localhost:3000/api/v1');
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(doc.components.schemas.Error.required).toEqual(expect.arrayContaining(['status', 'code', 'message', 'requestId']));
  });

  test('every $ref points to something that exists', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1].split('/'));
    expect(refs.length).toBeGreaterThan(10);
    refs.forEach((parts) => {
      let node = doc;
      parts.forEach((p) => { node = node?.[p]; });
      expect(node).toBeDefined();
    });
  });

  test('every operation documents its responses; protected ones document 401', () => {
    operations.forEach(({ op, route, method }) => {
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
      if (op.security === undefined) expect(op.responses['401']).toBeDefined(); // protected by default
      expect({ route, method, summary: Boolean(op.summary) }).toEqual({ route, method, summary: true });
    });
  });

  test('admin-only operations document 403', () => {
    ['POST /imports', 'DELETE /imports/{id}'].forEach((key) => {
      const [method, route] = key.split(' ');
      expect(doc.paths[route][method.toLowerCase()].responses['403']).toBeDefined();
    });
  });

  test('every documented operation exists in the app (not the "unknown route" 404)', async () => {
    for (const { method, route } of operations) {
      const url = `/api/v1${route.replace('{id}', 'aaaaaaaaaaaaaaaaaaaaaaaa')}`;
      const res = await supertest(app)[method](url).set('Authorization', `Bearer ${adminToken}`);
      expect({ method, route, unknownRoute: /Can't find/.test(res.body.message || '') }).toEqual({ method, route, unknownRoute: false });
    }
  });

  test('no route exists without being documented (count of route definitions = count of operations)', () => {
    const files = [...fs.readdirSync(path.join(ROOT, 'routes')).map((f) => path.join(ROOT, 'routes', f)), path.join(ROOT, 'app.js')];
    const defined = files.map((f) => fs.readFileSync(f, 'utf8'))
      .flatMap((src) => [...src.matchAll(/\.(get|post|put|patch|delete)\(\s*(['"]\/|\w+Controller\.|restrictTo|protect)/g)]);
    expect(defined.length).toBe(operations.length);
  });

  test('the documented error codes are the ones the API really sends', () => {
    const text = fs.readFileSync(path.join(ROOT, 'docs', 'openapi.yaml'), 'utf8');
    const sources = ['utils', 'controllers'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, d, f), 'utf8'))).join('\n');
    const documented = [...new Set([...text.matchAll(/`([A-Z][A-Z_]{4,})`/g)].map((m) => m[1]))];
    expect(documented.length).toBeGreaterThan(15);
    documented.forEach((code) => {
      // either written in the source, or one of the default codes derived from an HTTP status
      expect({ code, known: sources.includes(`'${code}'`) }).toEqual({ code, known: true });
    });
  });
});
