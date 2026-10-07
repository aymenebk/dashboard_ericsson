const { classify } = require('../utils/condition');
const { buildDashboard } = require('../utils/dashboardBuilder');

const DAY = new Date('2026-02-10T00:00:00Z');
const site = (neId, load, over = {}) => ({
  siteId: `id-${neId}`, neId, neType: 'AMM 20PB', wilayaCode: Math.floor(neId / 1000), load, lastUpdate: DAY, ...over,
});

describe('classify (provisional thresholds 50 / 80)', () => {
  test.each([
    [0, 'good'], [49.99, 'good'], [50, 'medium'], [79.99, 'medium'], [80, 'critical'], [100, 'critical'],
  ])('load %s -> %s', (load, expected) => expect(classify(load)).toBe(expected));

  test('no measurement is its own category, never "good"', () => {
    expect(classify(null)).toBe('no_data');
    expect(classify(undefined)).toBe('no_data');
  });
});

describe('buildDashboard', () => {
  const states = [site(1001, 90), site(2002, 65), site(3003, 5), site(4004, null), site(5005, 85)];

  test('totals count every site; grey sites are counted apart', () => {
    const d = buildDashboard(states);
    expect(d.totals).toEqual({ sites: 5, measured: 4, noData: 1 });
  });

  test('counts per condition, shares over ALL sites add up to 1', () => {
    const { byCondition } = buildDashboard(states);
    expect(byCondition).toEqual({
      critical: { count: 2, share: 0.4 },
      medium: { count: 1, share: 0.2 },
      good: { count: 1, share: 0.2 },
      no_data: { count: 1, share: 0.2 },
    });
    const sum = Object.values(byCondition).reduce((a, c) => a + c.share, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  test('top = highest load first, bottom = lowest first, grey sites never ranked', () => {
    const d = buildDashboard(states);
    expect(d.topSites.map((s) => s.neId)).toEqual([1001, 5005, 2002, 3003]);
    expect(d.bottomSites.map((s) => s.neId)).toEqual([3003, 2002, 5005, 1001]);
    expect([...d.topSites, ...d.bottomSites].some((s) => s.neId === 4004)).toBe(false);
  });

  test('limit cuts both lists', () => {
    const d = buildDashboard(states, { limit: 2 });
    expect(d.topSites).toHaveLength(2);
    expect(d.bottomSites.map((s) => s.neId)).toEqual([3003, 2002]);
  });

  test('ties: lower NeId first, then NeType alphabetically (same order on every call)', () => {
    const tied = [site(30, 70), site(10, 70), site(20, 70, { neType: 'AMM 20PB' }), site(20, 70, { neType: 'AMM 6PB' })];
    expect(buildDashboard(tied).topSites.map((s) => `${s.neId}|${s.neType}`))
      .toEqual(['10|AMM 20PB', '20|AMM 20PB', '20|AMM 6PB', '30|AMM 20PB']);
    expect(buildDashboard(tied).bottomSites.map((s) => s.neId)).toEqual([10, 20, 20, 30]);
  });

  test('items carry the condition and a load rounded to 2 decimals', () => {
    const [first] = buildDashboard([site(1001, 62.702127659574465)]).topSites;
    expect(first).toMatchObject({ neId: 1001, load: 62.7, condition: 'medium', wilayaCode: 1, siteId: 'id-1001' });
    expect(first.lastUpdate).toEqual(DAY);
  });

  test('latestUpdate is the most recent lastUpdate', () => {
    const later = new Date('2026-02-12T00:00:00Z');
    expect(buildDashboard([site(1, 10), site(2, 10, { lastUpdate: later })]).latestUpdate).toEqual(later);
  });

  test('no site at all: zeros, empty lists, no crash', () => {
    expect(buildDashboard([])).toEqual({
      latestUpdate: null,
      totals: { sites: 0, measured: 0, noData: 0 },
      byCondition: {
        critical: { count: 0, share: 0 }, medium: { count: 0, share: 0 },
        good: { count: 0, share: 0 }, no_data: { count: 0, share: 0 },
      },
      topSites: [],
      bottomSites: [],
    });
  });

  test('only grey sites: totals but empty rankings', () => {
    const d = buildDashboard([site(1, null), site(2, null)]);
    expect(d.totals).toEqual({ sites: 2, measured: 0, noData: 2 });
    expect(d.topSites).toEqual([]);
    expect(d.byCondition.no_data.share).toBe(1);
  });
});