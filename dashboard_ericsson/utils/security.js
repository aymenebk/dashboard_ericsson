// T11.4: HTTP hardening, kept out of app.js so that it can be read (and tested) on its own.
const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const AppError = require('./appError');
const logger = require('./logger');

const WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 300; // requests per IP per 15 minutes, whole API
const DEFAULT_LOGIN_RATE_MAX = 10; // FAILED logins per IP per 15 minutes

// Every request gets an id (returned in X-Request-Id and in error bodies) so that a client
// report can be matched with the server log line.
exports.requestId = (req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// One structured line per finished request. Only the path is logged, never the query string or any header.
exports.requestLogger = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', { requestId: req.id, method: req.method, path: req.path, statusCode: res.statusCode, ms: Math.round(ms) });
  });
  next();
};

exports.securityHeaders = () => helmet(); // helmet's defaults: CSP, no x-powered-by, nosniff, HSTS, frame protection...

// CORS_ORIGIN = comma-separated list of allowed browser origins (e.g. the frontend URL).
// Not set => no CORS headers at all: browsers refuse cross-origin calls. "*" is never accepted
// silently: it must be written explicitly.
exports.corsPolicy = (env = process.env) => {
  const origins = (env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0) return (req, res, next) => next();
  return cors({
    origin: origins.includes('*') ? '*' : origins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'], // Retry-After: the frontend tells the user how long to wait after a 429
    maxAge: 600,
  });
};

const tooMany = (what) => (req, res, next) => next(new AppError(`Too many ${what}. Please wait a few minutes and try again`, 429, 'RATE_LIMITED'));

exports.apiLimiter = (env = process.env) => rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(env.RATE_LIMIT_MAX) || DEFAULT_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health', // monitoring must never be throttled
  handler: tooMany('requests'),
});

// Brute-force protection: only failed attempts (status >= 400) count, a good login never uses the budget
exports.loginLimiter = (env = process.env) => rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(env.LOGIN_RATE_MAX) || DEFAULT_LOGIN_RATE_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: tooMany('failed login attempts'),
});
