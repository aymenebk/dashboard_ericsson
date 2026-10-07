const request = require('supertest');
const app = require('../app');

describe('Health route', () => {
  test('GET /api/v1/health returns 200 and success status', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('success');
  });
    test('Health reports database as disconnected when no connection is open', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.body.database).toBe('disconnected');
  });

  test('Unknown route returns a 404 JSON error', async () => {
    const res = await request(app).get('/api/v1/nothing-here');
    expect(res.statusCode).toBe(404);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toContain('/api/v1/nothing-here');
  });
});