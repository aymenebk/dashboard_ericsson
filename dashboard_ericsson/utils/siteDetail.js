// Pure function: the records of ONE site -> the content of its page. No database here.
const { classify } = require('./condition');
const { wilayaName } = require('../config/wilayas');
const { reportFor } = require('../config/reports');

const HISTORY_DAYS = 7;
const round = (n) => (n === null ? null : Math.round(n * 100) / 100);

/**
 * site:         { _id, neId, neType, wilayaCode }
 * links:        [{ _id, measurePoint, portRef, label, notInUse, entityType }]
 * measurements: [{ link, endTime, status, p95, failure, bins }]  (any order)
 *
 * A day's load is the load of the site's WORST measured link that day (null if every link failed).
 * "Last 7 days" = the last 7 days that have a record for this site (no weekday filter, no gap filling).
 */
function buildSiteDetail({ site, links, measurements }) {
  const linkById = new Map(links.map((l) => [String(l._id), l]));

  const byDay = new Map();
  measurements.forEach((m) => {
    const t = m.endTime.getTime();
    const day = byDay.get(t) || { t, load: null, records: 0, measured: 0, failures: new Set() };
    day.records += 1;
    if (m.status === 'OK') {
      day.measured += 1;
      if (day.load === null || m.p95 > day.load) day.load = m.p95;
    } else if (m.failure) {
      day.failures.add(m.failure);
    }
    byDay.set(t, day);
  });
  const daysNewestFirst = [...byDay.values()].sort((a, b) => b.t - a.t);
  const latest = daysNewestFirst[0];
  const window = daysNewestFirst.slice(0, HISTORY_DAYS).reverse(); // oldest first, for the chart

  const history = window.map((d) => ({
    date: new Date(d.t).toISOString().slice(0, 10),
    load: round(d.load),
    condition: classify(d.load),
    measuredLinks: d.measured,
    totalLinks: d.records,
  }));

  const measuredLoads = window.map((d) => d.load).filter((v) => v !== null);
  const summary = {
    windowDays: window.length,
    measuredDays: measuredLoads.length,
    average: measuredLoads.length ? round(measuredLoads.reduce((a, b) => a + b, 0) / measuredLoads.length) : null,
    maximum: measuredLoads.length ? round(Math.max(...measuredLoads)) : null,
    minimum: measuredLoads.length ? round(Math.min(...measuredLoads)) : null,
  };

  // Latest record of each link, and which link carries the current load
  const newestFirst = [...measurements].sort((a, b) => b.endTime - a.endTime);
  const latestByLink = new Map();
  newestFirst.forEach((m) => { if (!latestByLink.has(String(m.link))) latestByLink.set(String(m.link), m); });

  let worstLinkId = null;
  if (latest.load !== null) {
    const onLatestDay = [...latestByLink.entries()].find(([, m]) => m.endTime.getTime() === latest.t && m.status === 'OK' && m.p95 === latest.load);
    worstLinkId = onLatestDay ? onLatestDay[0] : null;
  }
  const linkItems = [...latestByLink.entries()]
    .filter(([id]) => linkById.has(id))
    .map(([id, m]) => {
      const l = linkById.get(id);
      return {
        linkId: l._id,
        measurePoint: l.measurePoint,
        portRef: l.portRef,
        label: l.label,
        notInUse: l.notInUse,
        entityType: l.entityType,
        endTime: m.endTime,
        status: m.status,
        failure: m.failure,
        load: m.status === 'OK' ? round(m.p95) : null,
        bins: m.bins,
        onLatestDay: m.endTime.getTime() === latest.t, // false = this link's latest record is older than the site's state
        isWorst: id === worstLinkId,
      };
    })
    // Links of the current day first (worst first), then links last seen on an older day
    .sort((a, b) => Number(b.onLatestDay) - Number(a.onLatestDay)
      || (b.load ?? -1) - (a.load ?? -1)
      || a.measurePoint.localeCompare(b.measurePoint));

  const condition = classify(latest.load);
  return {
    site: { id: site._id, neId: site.neId, neType: site.neType, wilayaCode: site.wilayaCode, wilayaName: wilayaName(site.wilayaCode) },
    current: {
      lastUpdate: new Date(latest.t),
      load: round(latest.load),
      condition,
      failureReasons: latest.load === null ? [...latest.failures] : [],
      noMeasurementReason: latest.load === null ? [...latest.failures].join('; ') || null : null,
    },
    summary,
    history,
    links: linkItems,
    report: reportFor(condition),
  };
}

module.exports = { buildSiteDetail, HISTORY_DAYS };