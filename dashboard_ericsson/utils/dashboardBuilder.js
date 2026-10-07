// Pure function: per-site states -> the blocks of the dashboard. No database here.
const { classify, CONDITIONS } = require('./condition');
const { wilayaName } = require('../config/wilayas');
const round = (n, digits) => Math.round(n * 10 ** digits) / 10 ** digits;

// Deterministic order: load, then lower NeId first, then NeType alphabetically
const byLoadDesc = (a, b) => b.load - a.load || a.neId - b.neId || a.neType.localeCompare(b.neType);
const byLoadAsc = (a, b) => a.load - b.load || a.neId - b.neId || a.neType.localeCompare(b.neType);

function buildDashboard(states, { limit = 10 } = {}) {
  const sites = states.map((s) => ({ ...s, condition: classify(s.load) }));
  const total = sites.length;

  const counts = Object.fromEntries(CONDITIONS.map((c) => [c, 0]));
  sites.forEach((s) => { counts[s.condition] += 1; });
  // Shares are over ALL sites in scope (grey included), so the four shares add up to 100 %
  const byCondition = Object.fromEntries(
    CONDITIONS.map((c) => [c, { count: counts[c], share: total ? round(counts[c] / total, 4) : 0 }]),
  );

  // Sites without a valid measurement are never ranked: unknown is not 0 %
  const measured = sites.filter((s) => s.load !== null);
  const item = (s) => ({
    siteId: s.siteId,
    neId: s.neId,
    neType: s.neType,
    wilayaCode: s.wilayaCode,
        wilayaName: wilayaName(s.wilayaCode),
    load: round(s.load, 2),
    condition: s.condition,
    lastUpdate: s.lastUpdate,
  });

  let latestUpdate = null;
  sites.forEach((s) => { if (!latestUpdate || s.lastUpdate > latestUpdate) latestUpdate = s.lastUpdate; });

  return {
    latestUpdate,
    totals: { sites: total, measured: measured.length, noData: counts.no_data },
    byCondition,
    topSites: [...measured].sort(byLoadDesc).slice(0, limit).map(item),
    bottomSites: [...measured].sort(byLoadAsc).slice(0, limit).map(item),
  };
}

module.exports = { buildDashboard };