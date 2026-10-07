const AppError = require('./appError');

// ?page=2&limit=50 -> { page, limit, skip }. Bad values are a 400; a limit above the cap is clamped.
exports.parsePagination = (query, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const read = (name, fallback) => {
    if (query[name] === undefined) return fallback;
    const raw = String(query[name]);
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new AppError(`"${name}" must be a positive integer`, 400);
    return Number(raw);
  };
  const page = read('page', 1);
  const limit = Math.min(read('limit', defaultLimit), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};