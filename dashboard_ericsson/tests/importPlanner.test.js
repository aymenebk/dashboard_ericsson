const fs = require('fs');
const path = require('path');
const { buildImportPlan } = require('../utils/importPlanner');
const { validateRows } = require('../utils/rowValidator');
const { readImportFile } = require('../utils/excelReader');

const bins = () => [86400, ...new Array(19).fill(0)];
const row = (over = {}) => ({
  sourceRow: 2, neId: 18870, neType: 'AMM 20PB', wilayaCode: 18, entityType: 'E',
  measurePoint: { raw: '1/11/104', portRef: '1/11/104', label: null, notInUse: false },
  endTime: new Date('2026-02-10T00:00:00Z'), failure: null, avgRaw: 5, maxRaw: 9, minRaw: 1,
  bins: bins(), issues: [], ...over,
});

describe('buildImportPlan', () => {
  test('one site and one link shared by two days; two measurement entries', () => {
    const { results } = validateRows([
      row({ sourceRow: 2 }),
      row({ sourceRow: 3, endTime: new Date('2026-02-11T00:00:00Z') }),
    ]);
    const plan = buildImportPlan(results);
    expect(plan.sites).toHaveLength(1);
    expect(plan.links).toHaveLength(1);
    expect(plan.entries).toHaveLength(2);
    expect(plan.sites[0]).toEqual({ neId: 18870, neType: 'AMM 20PB', wilayaCode: 18 });
  });

  test('same NeId with two NeType values gives two sites', () => {
    const { results } = validateRows([row({ sourceRow: 2 }), row({ sourceRow: 3, neType: 'SIU 02' })]);
    expect(buildImportPlan(results).sites).toHaveLength(2);
  });

  test('rejected rows create nothing but keep their issues', () => {
    const { results } = validateRows([row({ sourceRow: 2 }), row({ sourceRow: 3, bins: new Array(20).fill(0), measurePoint: { raw: '1/11/105', portRef: null, label: null, notInUse: false } })]);
    const plan = buildImportPlan(results);
    expect(plan.entries).toHaveLength(1);
    expect(plan.links).toHaveLength(1);
    expect(plan.issues).toEqual([expect.objectContaining({ sourceRow: 3, severity: 'error', code: 'BINS_ALL_ZERO' })]);
  });
});

const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
(fs.existsSync(REAL) ? describe : describe.skip)('real workbook plan', () => {
  test('1194 sites, 1200 links, 1200 entries, 56 warnings', async () => {
    const { rows } = await readImportFile(fs.readFileSync(REAL), 'xlsx');
    const plan = buildImportPlan(validateRows(rows).results);
    expect(plan.sites).toHaveLength(1194);
    expect(plan.links).toHaveLength(1200);
    expect(plan.entries).toHaveLength(1200);
    expect(plan.issues).toHaveLength(56);
    expect(plan.issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});