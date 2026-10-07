const { mediumFrom, criticalFrom } = require('../config/thresholds');

const CONDITIONS = ['critical', 'medium', 'good', 'no_data'];

// load = daily P95 in percent, or null when there is no valid measurement (shown in grey).
function classify(load) {
  if (load === null || load === undefined) return 'no_data';
  if (load >= criticalFrom) return 'critical';
  if (load >= mediumFrom) return 'medium';
  return 'good';
}

module.exports = { classify, CONDITIONS };