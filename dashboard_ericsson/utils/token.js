const jwt = require('jsonwebtoken');

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long');
  return s;
}

exports.signToken = (userId) => jwt.sign({ id: String(userId) }, secret(), {
  algorithm: 'HS256',
  expiresIn: process.env.JWT_EXPIRES_IN || '1d',
});

// Only HS256 is accepted: a token claiming another algorithm (or "none") is refused
exports.verifyToken = (token) => jwt.verify(token, secret(), { algorithms: ['HS256'] });