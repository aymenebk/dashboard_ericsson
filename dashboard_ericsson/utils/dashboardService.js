const Site = require('../models/siteModel');
const Measurement = require('../models/measurementModel');

/**
 * Current state of every site: its most recent day with data, and on that day the load of its
 * WORST link (highest P95 among the links that were measured). If every link of that latest day
 * failed, the load is null (grey): an unknown is never shown as an old value or as 0 %.
 *
 * Scope: optionally one import, optionally "as of" a day (measurements strictly before `before`).
 * Method: list the days newest first and resolve each site on the first day it appears, so each
 * row is read at most once and a full daily file costs one day of rows.
 */
async function computeSiteStates({ importId = null, before = null } = {}) {
  const scope = {};
  if (importId) scope.import = importId;
  if (before) scope.endTime = { $lt: before };

  const [dayList, siteIds] = await Promise.all([
    Measurement.distinct('endTime', scope),
    Measurement.distinct('site', scope),
  ]);
  if (siteIds.length === 0) return [];
  const days = [...dayList].sort((a, b) => b - a);

  const stateBySite = new Map();
  const pending = new Set(siteIds.map(String));
  for (const day of days) {
    if (pending.size === 0) break;
    const filter = { endTime: day };
    if (importId) filter.import = importId;
    const rows = await Measurement.find(filter, 'site status p95 failure').lean();

    const worst = new Map();
    const failures = new Map(); // site -> distinct failure texts of that day (only used when no link was measured)
    rows.forEach((r) => {
      const key = String(r.site);
      if (!pending.has(key)) return;
      const load = r.status === 'OK' ? r.p95 : null;
      if (!worst.has(key)) worst.set(key, load);
      else if (load !== null && (worst.get(key) === null || load > worst.get(key))) worst.set(key, load);
      if (r.status !== 'OK') {
        if (!failures.has(key)) failures.set(key, new Set());
        failures.get(key).add(r.failure || r.status);
      }
    });
    worst.forEach((load, key) => {
      const state = { load, lastUpdate: day };
      if (load === null) state.noMeasurementReason = [...(failures.get(key) || [])].join('; ') || null;
      stateBySite.set(key, state);
      pending.delete(key);
    });
  }

  const sites = await Site.find({ _id: { $in: siteIds } }, 'neId neType wilayaCode').lean();
  return sites.map((s) => ({
    siteId: s._id,
    neId: s.neId,
    neType: s.neType,
    wilayaCode: s.wilayaCode,
    ...stateBySite.get(String(s._id)),
  }));
}

module.exports = { computeSiteStates };