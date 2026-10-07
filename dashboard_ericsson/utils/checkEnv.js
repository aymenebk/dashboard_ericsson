// Fail fast at startup with a clear message instead of failing later, in the middle of a request.
const REQUIRED = ['DATABASE_LOCAL', 'JWT_SECRET'];
const POSITIVE_INTEGERS = ['RATE_LIMIT_MAX', 'LOGIN_RATE_MAX', 'TRUST_PROXY'];
const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

exports.checkEnv = (env = process.env) => {
  const problems = [];
  REQUIRED.forEach((key) => { if (!env[key]) problems.push(`${key} is missing`); });
  if (env.JWT_SECRET && env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters long');
  if (env.JWT_EXPIRES_IN && !/^\d+[smhd]$/.test(env.JWT_EXPIRES_IN)) problems.push('JWT_EXPIRES_IN must look like 30m, 12h or 1d');
  POSITIVE_INTEGERS.forEach((key) => {
    if (env[key] !== undefined && !/^[1-9]\d*$/.test(env[key])) problems.push(`${key} must be a positive whole number`);
  });
  if (env.LOG_LEVEL && !LOG_LEVELS.includes(env.LOG_LEVEL.toLowerCase())) problems.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  if (problems.length) throw new Error(`Invalid configuration in config.env: ${problems.join('; ')}`);
};