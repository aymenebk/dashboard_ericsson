// T12: every kind of error leaves the API in the same shape, and nothing internal leaks.
const errorHandler = require('../controllers/errorController');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

function run(err) {
  const res = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  errorHandler(err, { id: 'req-1', method: 'GET', path: '/x', ip: '::1' }, res, next);
  return { res, next, status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}
const withName = (name, props = {}) => Object.assign(new Error('internal detail /srv/app/secret.js'), { name, ...props });

describe('known errors become predictable answers', () => {
  test.each([
    ['AppError', new AppError('Nope', 404), 404, 'NOT_FOUND'],
    ['AppError with its own code and details', new AppError('Dup', 409, 'IMPORT_DUPLICATE_FILE', { importId: 'x' }), 409, 'IMPORT_DUPLICATE_FILE'],
    ['malformed JSON', Object.assign(new SyntaxError('Unexpected token'), { type: 'entity.parse.failed' }), 400, 'MALFORMED_JSON'],
    ['body too large', Object.assign(new Error('too big'), { type: 'entity.too.large' }), 413, 'PAYLOAD_TOO_LARGE'],
    ['multer size', withName('MulterError', { code: 'LIMIT_FILE_SIZE' }), 413, 'FILE_TOO_LARGE'],
    ['multer other', withName('MulterError', { code: 'LIMIT_UNEXPECTED_FILE' }), 400, 'UPLOAD_INVALID'],
    ['expired token', withName('TokenExpiredError'), 401, 'TOKEN_EXPIRED'],
    ['bad token', withName('JsonWebTokenError'), 401, 'TOKEN_INVALID'],
    ['mongoose cast', withName('CastError', { path: '_id' }), 400, 'INVALID_VALUE'],
    ['duplicate key', withName('MongoServerError', { code: 11000, keyPattern: { sha256: 1 }, keyValue: { sha256: 'abc' } }), 409, 'DUPLICATE_KEY'],
    ['mongo down', withName('MongoServerSelectionError'), 503, 'DATABASE_UNAVAILABLE'],
    ['mongoose buffering', Object.assign(new Error('Operation `users.findOne()` buffering timed out after 10000ms'), { name: 'MongooseError' }), 503, 'DATABASE_UNAVAILABLE'],
  ])('%s', (label, err, status, code) => {
    const out = run(err);
    expect(out.status).toBe(status);
    expect(out.body.code).toBe(code);
    expect(out.body.requestId).toBe('req-1');
    expect(['fail', 'error']).toContain(out.body.status);
    expect(typeof out.body.message).toBe('string');
    expect(Object.keys(out.body)).toEqual(expect.arrayContaining(['code', 'message', 'requestId', 'status']));
  });

  test('mongoose validation: 400 VALIDATION_ERROR listing the fields', () => {
    const err = withName('ValidationError', { errors: { neId: { message: 'A site needs a NeId' } } });
    const out = run(err);
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: [{ field: 'neId', message: 'A site needs a NeId' }] } });
  });

  test('a duplicate key reveals the field names, never the values', () => {
    const out = run(withName('MongoServerError', { code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'victim@example.com' } }));
    expect(out.body.details).toEqual({ fields: ['email'] });
    expect(JSON.stringify(out.body)).not.toContain('victim@example.com');
  });

  test('the messages of internal errors are never copied to the client', () => {
    ['CastError', 'MongoServerSelectionError', 'JsonWebTokenError', 'MulterError'].forEach((name) => {
      expect(JSON.stringify(run(withName(name, { path: 'p' })).body)).not.toContain('/srv/app/secret.js');
    });
  });
});

describe('unexpected errors', () => {
  test('500 INTERNAL_ERROR with a generic message: no stack, no path, no original text', () => {
    const err = new Error('ENOENT: open C:\\Users\\someone\\secret.env, mongodb://user:pass@host/db');
    const out = run(err);
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ status: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: 'req-1' });
  });

  test('this holds in development too (the stack goes to the log only)', () => {
    const previous = { env: process.env.NODE_ENV, level: process.env.LOG_LEVEL };
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'silent';
    try {
      expect(JSON.stringify(run(new Error('boom')).body)).not.toMatch(/stack|boom|\.js/);
    } finally {
      process.env.NODE_ENV = previous.env;
      if (previous.level === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous.level;
    }
  });

  test('a non-Error value thrown by some library is still a clean 500', () => {
    expect(run('a string').status).toBe(500);
    expect(run(undefined).status).toBe(500);
  });

  test('it is logged server-side with the stack', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';
    try {
      run(new Error('visible only in the log'));
      const line = JSON.parse(spy.mock.calls[0][0]);
      expect(line).toMatchObject({ level: 'error', message: 'unexpected error', requestId: 'req-1' });
      expect(line.error.message).toBe('visible only in the log');
      expect(line.error.stack).toContain('errorHandler.test.js');
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous;
    }
  });

  test('if the response already started, the error is handed to Express instead of writing twice', () => {
    const res = { headersSent: true, status: jest.fn(), json: jest.fn() };
    const next = jest.fn();
    const err = new Error('late');
    errorHandler(err, { id: 'r' }, res, next);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('logger', () => {
  const capture = (fn) => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'debug';
    try {
      fn();
      return [...out.mock.calls, ...err.mock.calls].map((c) => JSON.parse(c[0]));
    } finally {
      out.mockRestore();
      err.mockRestore();
      if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous;
    }
  };

  test('one JSON object per line with time, level and message', () => {
    const [line] = capture(() => logger.info('hello', { importId: 'abc' }));
    expect(line).toMatchObject({ level: 'info', message: 'hello', importId: 'abc' });
    expect(new Date(line.time).toString()).not.toBe('Invalid Date');
  });

  test('secrets are redacted whatever the caller passes', () => {
    const [line] = capture(() => logger.info('x', { password: 'p', JWT_SECRET: 's', token: 't', authorization: 'Bearer z', Cookie: 'c', safe: 1 }));
    expect(line).toMatchObject({ password: '[redacted]', JWT_SECRET: '[redacted]', token: '[redacted]', authorization: '[redacted]', Cookie: '[redacted]', safe: 1 });
  });

  test('silent under Jest unless LOG_LEVEL is set', () => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('should not appear');
    expect(out).not.toHaveBeenCalled();
    out.mockRestore();
  });
});
