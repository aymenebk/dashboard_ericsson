const AppError = require('./appError');
const { findSuccessfulImport } = require('./importLookup');

// "2026-02-12" -> Date at 00:00 UTC, or null if it is not a real calendar date
function parseDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? null : d;
}

/**
 * ?import=<id>&date=YYYY-MM-DD -> { importId, before, asOf }
 *  - importId: only measurements of that import (400 if malformed, 404 if unknown)
 *  - before:   exclusive upper bound = the end of the given day ("state as of that day")
 */
async function parseScope(query) {
  let importId = null;
  if (query.import !== undefined) importId = (await findSuccessfulImport(String(query.import)))._id;

  let before = null;
  let asOf = null;
  if (query.date !== undefined) {
    const day = parseDay(String(query.date));
    if (!day) throw new AppError('"date" must be a real day written YYYY-MM-DD', 400);
    before = new Date(day.getTime() + 24 * 3600 * 1000);
    asOf = String(query.date);
  }
  return { importId, before, asOf };
}

module.exports = { parseScope, parseDay };