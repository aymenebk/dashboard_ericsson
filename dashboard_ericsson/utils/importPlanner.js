// Pure function: turns the validator output (T4) into the lists the database layer needs.
// No Mongoose here, so it can be tested on the real workbook without a database.

const siteKeyOf = (row) => `${row.neId}|${row.neType}`;
const linkKeyOf = (row) => `${siteKeyOf(row)}|${row.measurePoint.raw}`;

function buildImportPlan(results) {
  const sites = new Map();
  const links = new Map();
  const entries = [];
  const issues = [];

  results.forEach((result) => {
    result.issues.forEach((i) => issues.push({ sourceRow: result.sourceRow, ...i }));
    if (result.outcome !== 'accepted') return; // rejected rows only leave their issues

    const { row } = result;
    const siteKey = siteKeyOf(row);
    const linkKey = linkKeyOf(row);
    if (!sites.has(siteKey)) {
      sites.set(siteKey, { neId: row.neId, neType: row.neType, wilayaCode: row.wilayaCode });
    }
    if (!links.has(linkKey)) {
      links.set(linkKey, {
        siteKey,
        measurePoint: row.measurePoint.raw,
        portRef: row.measurePoint.portRef,
        label: row.measurePoint.label,
        notInUse: row.measurePoint.notInUse,
        entityType: row.entityType,
      });
    }
    entries.push({ result, siteKey, linkKey });
  });

  return { sites: [...sites.values()], links: [...links.entries()].map(([key, l]) => ({ key, ...l })), entries, issues };
}

module.exports = { buildImportPlan, siteKeyOf, linkKeyOf };