const { computeMetrics } = require('./calc/saturation');

const { WILAYA_COUNT } = require('../config/wilayas');

// Business rules applied to rows already parsed by excelReader (T3).
// A row is either "accepted" (possibly with warnings) or "rejected" (at least one error).
// Accepted rows carry a status: OK (measured) or PM_* (no measurement, never ranked).

const REASON_MESSAGES = {
  BINS_ALL_ZERO: 'All 20 bins are 0 but Failure is empty',
  BINS_SUM_MISMATCH: 'The 20 bins do not sum to 86400 seconds',
  BINS_NEGATIVE: 'A bin is negative',
  BINS_NOT_INTEGER: 'A bin is not an integer',
  BINS_LENGTH: 'The row does not have 20 bins',
};

function classifyFailure(failure) {
  if (failure === null) return null;
  const f = failure.toLowerCase();
  if (f.includes('not reachable')) return 'PM_NOT_REACHABLE';
  if (f.includes('invalid')) return 'PM_INVALID';
  return 'PM_OTHER';
}

function validateRow(row) {
  const issues = [];
  const error = (code, message) => issues.push({ severity: 'error', code, message });
  const warning = (code, message) => issues.push({ severity: 'warning', code, message });
  const reject = () => ({ sourceRow: row.sourceRow, outcome: 'rejected', status: null, metrics: null, issues, row });

  // 1. Cells that could not be parsed (T3)
  row.issues.forEach((i) => error(i.code, i.message));
  if (issues.length) return reject();

  // 2. Soft checks on identity and date
   if (row.wilayaCode === null) {
    warning('WILAYA_UNKNOWN', `NeId ${row.neId} has fewer than 4 digits: no wilaya code`);
  } else if (row.wilayaCode > WILAYA_COUNT) {
    warning('WILAYA_OUT_OF_RANGE', `NeId ${row.neId} gives wilaya code ${row.wilayaCode}, but there are only ${WILAYA_COUNT} wilayas`);
  }
  const t = row.endTime;
  if (t.getUTCHours() || t.getUTCMinutes() || t.getUTCSeconds()) {
    warning('ENDTIME_NOT_MIDNIGHT', 'EndTime is not 00:00:00: the model expects one record per link per day');
  }

  // 3. Failure rows: kept as coverage information, never measured, never ranked
  const failureStatus = classifyFailure(row.failure);
  if (failureStatus) {
    if (failureStatus === 'PM_OTHER') warning('UNKNOWN_FAILURE', `Unrecognised failure text: "${row.failure}"`);
    if (row.bins.some((b) => b !== 0)) warning('FAILURE_WITH_DATA', 'Failure is set but bins are not all 0: bins ignored');
    return { sourceRow: row.sourceRow, outcome: 'accepted', status: failureStatus, metrics: null, issues, row };
  }

  // 4. Measured rows: bins must be consistent, then metrics are computed
  const metrics = computeMetrics(row.bins);
  if (!metrics.ok) {
    error(metrics.reason, REASON_MESSAGES[metrics.reason] || metrics.reason);
    return reject();
  }
  // Unit of Avg/Max/Min is unknown, but their order must hold whatever the unit
  if (!(row.minRaw <= row.avgRaw && row.avgRaw <= row.maxRaw)) {
    warning('AVG_MAX_MIN_ORDER', 'Min <= Avg <= Max does not hold');
  }
  return { sourceRow: row.sourceRow, outcome: 'accepted', status: 'OK', metrics, issues, row };
}

// Whole file: row rules + rules that need several rows (duplicates, NeId with two types).
function validateRows(rows) {
  const typesByNeId = new Map();
  rows.forEach((r) => {
    if (r.neId === null || !r.neType) return;
    if (!typesByNeId.has(r.neId)) typesByNeId.set(r.neId, new Set());
    typesByNeId.get(r.neId).add(r.neType);
  });

  const seen = new Map(); // link + day -> source row of the first occurrence
  const results = rows.map((row) => {
    const result = validateRow(row);
    if (result.outcome === 'rejected') return result;

    const key = `${row.neId}|${row.neType}|${row.measurePoint.raw}|${row.endTime.toISOString()}`;
    if (seen.has(key)) {
      result.issues.push({
        severity: 'error',
        code: 'DUPLICATE_IN_FILE',
        message: `Same site, measure point and day as row ${seen.get(key)}`,
      });
      return { ...result, outcome: 'rejected', status: null, metrics: null };
    }
    seen.set(key, row.sourceRow);

    if (typesByNeId.get(row.neId).size > 1) {
      result.issues.push({
        severity: 'warning',
        code: 'NEID_MULTIPLE_NETYPE',
        message: `NeId ${row.neId} appears with ${typesByNeId.get(row.neId).size} different NeType values`,
      });
    }
    return result;
  });

  const summary = {
    total: results.length,
    accepted: results.filter((r) => r.outcome === 'accepted').length,
    rejected: results.filter((r) => r.outcome === 'rejected').length,
    valid: results.filter((r) => r.status === 'OK').length,
    failed: results.filter((r) => r.status && r.status !== 'OK').length,
    withWarnings: results.filter((r) => r.outcome === 'accepted' && r.issues.length > 0).length,
    byStatus: {},
    issueCounts: {},
  };
  results.forEach((r) => {
    if (r.status) summary.byStatus[r.status] = (summary.byStatus[r.status] || 0) + 1;
    r.issues.forEach((i) => { summary.issueCounts[i.code] = (summary.issueCounts[i.code] || 0) + 1; });
  });
  return { results, summary };
}

module.exports = { validateRow, validateRows, classifyFailure };