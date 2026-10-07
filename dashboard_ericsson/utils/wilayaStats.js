// Pure function: per-site states -> the "Top wilayas" block. No database here.
const { classify } = require('./condition');
const { wilayaName } = require('../config/wilayas');

const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * For every wilaya: sites, measured sites, critical sites.
 *  - rate            = critical / sites of that wilaya (grey sites included, as in the mock-up footnote)
 *  - shareOfCritical = critical / ALL critical sites of the scope, so the shares of every wilaya
 *                      (plus "unassigned") add up to 100 %, whichever wilayas are displayed
 * Sites whose NeId gives no wilaya code are counted apart ("unassigned"), never dropped.
 * Only wilayas with at least one critical site are ranked.
 */
function buildWilayaBlock(states, { limit = 5 } = {}) {
  const byCode = new Map();
  const unassigned = { sites: 0, critical: 0 };
  let criticalSites = 0;

  states.forEach((s) => {
    const critical = classify(s.load) === 'critical';
    if (critical) criticalSites += 1;
    if (s.wilayaCode === null || s.wilayaCode === undefined) {
      unassigned.sites += 1;
      if (critical) unassigned.critical += 1;
      return;
    }
    const w = byCode.get(s.wilayaCode) || { wilayaCode: s.wilayaCode, total: 0, measured: 0, critical: 0 };
    w.total += 1;
    if (s.load !== null) w.measured += 1;
    if (critical) w.critical += 1;
    byCode.set(s.wilayaCode, w);
  });

  const ranked = [...byCode.values()]
    .filter((w) => w.critical > 0)
    .map((w) => ({
      wilayaCode: w.wilayaCode,
      name: wilayaName(w.wilayaCode),
      total: w.total,
      measured: w.measured,
      critical: w.critical,
      rate: round(w.critical / w.total, 4),
      shareOfCritical: round(w.critical / criticalSites, 4),
    }))
    .sort((a, b) => b.critical - a.critical || b.rate - a.rate || a.wilayaCode - b.wilayaCode);

  return { criticalSites, top: ranked.slice(0, limit), unassigned };
}

module.exports = { buildWilayaBlock };