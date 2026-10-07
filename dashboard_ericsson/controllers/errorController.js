const AppError = require('../utils/appError');
const logger = require('../utils/logger');

// Every error leaves the API in ONE shape:
//   { status: 'fail' | 'error', code: 'MACHINE_READABLE', message: 'Human text', details?: ..., requestId }
// Stack traces, Mongo internals, file paths and JWT details never reach the client: they go to the server log only.

const isMongoUnavailable = (err) => ['MongoNetworkError', 'MongoServerSelectionError', 'MongoNotConnectedError', 'MongoTopologyClosedError'].includes(err.name)
  || (err.name === 'MongooseError' && /buffering timed out/i.test(err.message));

// Turns a known library error into an AppError (or returns null if it is not one we recognise)
function translate(err) {
  // Body parser (express.json)
  if (err.type === 'entity.parse.failed') return new AppError('Malformed JSON in the request body', 400, 'MALFORMED_JSON');
  if (err.type === 'entity.too.large') return new AppError('Request body too large', 413, 'PAYLOAD_TOO_LARGE');
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
    return new AppError('Unsupported request encoding', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }

  // Upload (multer)
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return new AppError('File too large (maximum 10 MB)', 413, 'FILE_TOO_LARGE');
    return new AppError('The upload request is not valid: send exactly one file in the field "file"', 400, 'UPLOAD_INVALID');
  }

  // JWT
  if (err.name === 'TokenExpiredError') return new AppError('Your session has expired. Please log in again', 401, 'TOKEN_EXPIRED');
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return new AppError('Invalid token. Please log in again', 401, 'TOKEN_INVALID');
  }

  // Mongoose / MongoDB
  if (err.name === 'ValidationError' && err.errors) {
    const fields = Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }));
    return new AppError('Some values are not valid', 400, 'VALIDATION_ERROR', { fields });
  }
  if (err.name === 'CastError') {
    return new AppError(`Invalid value for "${err.path}"`, 400, 'INVALID_VALUE');
  }
  if (err.code === 11000) {
    return new AppError('This record already exists', 409, 'DUPLICATE_KEY', { fields: Object.keys(err.keyPattern || {}) });
  }
  if (isMongoUnavailable(err)) {
    return new AppError('The database is temporarily unavailable. Please try again shortly', 503, 'DATABASE_UNAVAILABLE');
  }
  return null;
}

module.exports = (err, req, res, next) => {
  if (res.headersSent) return next(err); // too late to send JSON: let Express close the connection
  if (err === null || typeof err !== 'object') err = new Error(String(err)); // something threw a string or nothing at all

  const known = err instanceof AppError && err.isOperational ? err : translate(err);

  if (known) {
    // Failed logins, bad tokens, forbidden actions and throttling are worth a trace; other 4xx are the client's mistake
    if ([401, 403, 429].includes(known.statusCode)) {
      logger.warn('request refused', { requestId: req.id, method: req.method, path: req.path, statusCode: known.statusCode, code: known.code, ip: req.ip });
    } else if (known.statusCode >= 500) {
      logger.error('service error', { requestId: req.id, method: req.method, path: req.path, code: known.code, error: logger.describeError(err) });
    }
    return res.status(known.statusCode).json({
      status: known.status,
      code: known.code,
      message: known.message,
      ...(known.details !== undefined ? { details: known.details } : {}),
      requestId: req.id,
    });
  }

  logger.error('unexpected error', { requestId: req.id, method: req.method, path: req.path, error: logger.describeError(err) });
  return res.status(500).json({ status: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: req.id });
};
