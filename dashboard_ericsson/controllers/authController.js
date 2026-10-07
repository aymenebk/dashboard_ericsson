const bcrypt = require('bcryptjs');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const User = require('../models/userModel');
const { signToken, verifyToken } = require('../utils/token');
const { ID_FORMAT } = require('../utils/importLookup');

// A valid bcrypt hash of a random string. Compared against when the email is unknown, so that
// "unknown email" and "wrong password" take the same time and cannot be told apart.
const DUMMY_HASH = '$2b$12$yI4Tq2QUT/kSZ4gY2ioPR.IdRN6JLFpeTSuwqE9H7eslIQS/CVHgS';
exports.DUMMY_HASH = DUMMY_HASH;

const publicUser = (user) => ({ id: user._id, email: user.email, role: user.role });

// POST /auth/login  { email, password }
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body || {};
  // Strings only: an object such as {"$gt": ""} must never reach the database query
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return next(new AppError('Please provide an email and a password, both as text', 400, 'VALIDATION_ERROR'));
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  const passwordOk = user ? await user.correctPassword(password) : await bcrypt.compare(password, DUMMY_HASH).then(() => false);
  if (!user || !passwordOk || !user.active) return next(new AppError('Incorrect email or password', 401, 'INVALID_CREDENTIALS'));

  res.status(200).json({ status: 'success', token: signToken(user._id), data: { user: publicUser(user) } });
});

// Middleware: a valid "Authorization: Bearer <token>" of an existing, active user is required
exports.protect = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('You are not logged in. Please log in to get access', 401, 'TOKEN_MISSING'));
  }

  let payload;
  try {
    payload = verifyToken(header.slice(7).trim());
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Your session has expired. Please log in again', 401, 'TOKEN_EXPIRED'));
    return next(new AppError('Invalid token. Please log in again', 401, 'TOKEN_INVALID'));
  }
  if (!ID_FORMAT.test(String(payload.id))) return next(new AppError('Invalid token. Please log in again', 401, 'TOKEN_INVALID'));

  const user = await User.findById(payload.id);
  if (!user || !user.active) return next(new AppError('The account of this token no longer exists or is disabled', 401, 'ACCOUNT_DISABLED'));
  if (user.changedPasswordAfter(payload.iat)) {
    return next(new AppError('The password was changed recently. Please log in again', 401, 'TOKEN_INVALID'));
  }

  req.user = user;
  next();
});

// Middleware: after protect, only the listed roles may continue
exports.restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return next(new AppError('You do not have permission to perform this action', 403));
  next();
};

// GET /auth/me
exports.me = (req, res) => {
  res.status(200).json({ status: 'success', data: { user: publicUser(req.user) } });
};