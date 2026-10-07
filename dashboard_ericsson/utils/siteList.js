// Pure functions for the "All sites" list. No database here.
const AppError = require('./appError');
const { classify, CONDITIONS } = require('./condition');
const { wilayaName } = require('../config/wilayas');

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;
const byLoadDesc = (a, b) => b.load - a.load || a.neId - b.neId || a.neType.localeCompare(b.neType);
const byLoadAsc = (a, b) => a.load - b.load || a.neId - b.neId || a.neType.localeCompare(b.neType);
const byIdentity = (a, b) => a.neId - b.neId || a.neType.localeCompare(b.neType);

// ?neId=18&wilaya=21&condition=critical&sort=load_asc -> validated filters (400 on bad values)
function parseSiteFilters(query) {
  const out = { sort: 'load_desc' };
  if (query.neId !== undefined) {
    if (!/^\d{1,9}$/.test(String(query.neId))) throw new AppError('"neId" must be digits only (the start of a NeId)', 400);
    out.neId = String(query.neId);
  }
  if (query.wilaya !== undefined) {
    const w = String(query.wilaya);
    if (!/^\d{1,2}$/.test(w) || Number(w) < 1) throw new AppError('"wilaya" must be a wilaya code (a number from 1 to 99)', 400);
    out.wilaya = Number(w);
  }
  if (query.condition !== undefined) {
    if (!CONDITIONS.includes(query.condition)) throw new AppError(`"condition" must be one of: ${CONDITIONS.join(', ')}`, 400);
    out.condition = query.condition;
  }
  if (query.sort !== undefined) {
    if (!['load_desc', 'load_asc'].includes(query.sort)) throw new AppError('"sort" must be load_desc or load_asc', 400);
    out.sort = query.sort;
  }
  return out;
}

/**
 * Filters then sorts the per-site states. Sites without a measurement (grey) always come LAST,
 * whichever direction is chosen: an unknown load is neither the highest nor the lowest.
 */
function listSites(states, { neId, wilaya, condition, sort = 'load_desc' } = {}) {
  let sites = states.map((s) => ({ ...s, condition: classify(s.load) }));
  if (neId) sites = sites.filter((s) => String(s.neId).startsWith(neId));
  if (wilaya) sites = sites.filter((s) => s.wilayaCode === wilaya);
  if (condition) sites = sites.filter((s) => s.condition === condition);

  const measured = sites.filter((s) => s.load !== null).sort(sort === 'load_asc' ? byLoadAsc : byLoadDesc);
  const grey = sites.filter((s) => s.load === null).sort(byIdentity);
  return [...measured, ...grey];
}

const toListItem = (s) => ({
  siteId: s.siteId,
  neId: s.neId,
  neType: s.neType,
  wilayaCode: s.wilayaCode,
  wilayaName: wilayaName(s.wilayaCode),
  load: s.load === null ? null : round(s.load, 2),
  condition: s.condition,
  noMeasurementReason: s.load === null ? s.noMeasurementReason ?? null : null,
  lastUpdate: s.lastUpdate,
});

module.exports = { parseSiteFilters, listSites, toListItem };