require('dotenv').config({ path: './config.env' });
const mongoose = require('mongoose');
const { testConnectOptions } = require('./helpers/dbConnect');
const request = require('supertest');
const app = require('../app');

describe('MongoDB connection', () => {
  beforeAll(async () => {
     await mongoose.connect(process.env.DATABASE_TEST, testConnectOptions);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  test('connection is open (readyState 1)', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });

  test('database answers a ping', async () => {
    const result = await mongoose.connection.db.admin().ping();
    expect(result.ok).toBe(1);
  });

  test('health route reports database as connected', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.database).toBe('connected');
  });
});