// Text of the "Report" box of the site page, one per condition. Thresholds are filled in from
// config/thresholds.js, so changing a threshold changes the text too.
// WORDING NOTE: the mock-up said "running at 80% or more of its capacity". We cannot claim that:
// the capacity is unknown (question Q3) and the load is the 95th percentile of the day.
const thresholds = require('./thresholds');

const REPORTS = {
  critical: {
    title: 'Critical',
    text: 'Critical load. For at least 5% of the day (about 72 minutes), at least one link of this site was at {critical}% utilization or more. This can cause congestion and a poorer service for users. Recommended actions: review the recent traffic growth, plan a capacity upgrade or load balancing with neighboring sites, and follow this site daily until its load goes back below {critical}%.',
  },
  medium: {
    title: 'Medium',
    text: 'Medium load. The busiest 5% of the day reached between {medium}% and {critical}% utilization. No immediate action is needed. Keep following the trend and check whether the load keeps growing.',
  },
  good: {
    title: 'Good',
    text: 'Good load. The busiest 5% of the day stayed below {medium}% utilization. No action is needed.',
  },
  no_data: {
    title: 'No measurement',
    text: 'No measurement. The latest records of this site are performance-monitoring failures, so its load is unknown. This does not mean the site is idle or down. Check the data collection (PM) for this site.',
  },
};

const fill = (text) => text
  .replaceAll('{medium}', String(thresholds.mediumFrom))
  .replaceAll('{critical}', String(thresholds.criticalFrom));

exports.reportFor = (condition) => {
  const report = REPORTS[condition];
  return { level: condition, title: report.title, text: fill(report.text) };
};