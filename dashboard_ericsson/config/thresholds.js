// PROVISIONAL thresholds, copied from the mock-up. They must be confirmed by a telecom engineer
// (questions Q3 and Q4): what the percentage refers to, where 50 and 80 fall, and how long a site
// must stay above a level before it counts. Change them here only: nothing else hard-codes them.
module.exports = {
  metric: 'p95', // 95th percentile of the daily utilization (level exceeded 5 % of the day)
  mediumFrom: 50, // good: load < 50
  criticalFrom: 80, // medium: 50 <= load < 80; critical: load >= 80
};