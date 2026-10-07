const { WILAYAS, WILAYA_COUNT, wilayaName } = require('../config/wilayas');
const { buildWilayaBlock } = require('../utils/wilayaStats');
const { validateRow } = require('../utils/rowValidator');
const { wilayaCodeFromNeId } = require('../utils/wilaya');

const DAY = new Date('2026-02-10T00:00:00Z');
const site = (neId, load, over = {}) => ({
  siteId: `id-${neId}`, neId, neType: 'AMM 20PB', wilayaCode: wilayaCodeFromNeId(neId), load, lastUpdate: DAY, ...over,
});

describe('wilaya table', () => {
  test('58 wilayas, numbered 1 to 58 without a gap, all names distinct and non-empty', () => {
    expect(WILAYA_COUNT).toBe(58);
    expect(Object.keys(WILAYAS).map(Number)).toEqual(Array.from({ length: 58 }, (_, i) => i + 1));
    const names = Object.values(WILAYAS);
    expect(names.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(58);
  });

  test.each([[1, 'Adrar'], [15, 'Tizi Ouzou'], [16, 'Alger'], [25, 'Constantine'], [31, 'Oran'], [47, 'Ghardaïa'], [58, 'El Meniaa']])(
    'code %i is %s', (code, name) => expect(wilayaName(code)).toBe(name),
  );

  test('unknown or missing codes have no name', () => {
    for (const c of [0, 59, 99, -1, 1.5, null, undefined, '16']) expect(wilayaName(c)).toBeNull();
  });
});

describe('import warning for a code outside 1..58', () => {
  const row = (neId) => ({
    sourceRow: 2, neId, neType: 'X', wilayaCode: wilayaCodeFromNeId(neId), entityType: 'E',
    measurePoint: { raw: '1/11/1', portRef: '1/11/1', label: null, notInUse: false },
    endTime: DAY, failure: null, avgRaw: 5, maxRaw: 9, minRaw: 1,
    bins: [86400, ...new Array(19).fill(0)], issues: [],
  });
  const codes = (neId) => validateRow(row(neId)).issues.map((i) => i.code);

  test('NeId 58001 -> wilaya 58: fine; NeId 59001 -> wilaya 59: warning, row still accepted', () => {
    expect(codes(58001)).toEqual([]);
    expect(codes(59001)).toEqual(['WILAYA_OUT_OF_RANGE']);
    expect(validateRow(row(59001)).outcome).toBe('accepted');
    expect(codes(99999)).toEqual(['WILAYA_OUT_OF_RANGE']);
  });
  test('fewer than 4 digits keeps its own warning', () => {
    expect(codes(345)).toEqual(['WILAYA_UNKNOWN']);
  });
});

describe('buildWilayaBlock', () => {
  // wilaya 16: 3 sites (2 critical, 1 medium); wilaya 31: 2 sites (1 critical, 1 grey); wilaya 5: 1 site (medium)
  const states = [
    site(16001, 90), site(16002, 85), site(16003, 60),
    site(31001, 95), site(31002, null),
    site(5001, 70),
  ];

  test('critical per wilaya, total, measured, rate over ALL sites of the wilaya', () => {
    const { top } = buildWilayaBlock(states);
    expect(top).toEqual([
      { wilayaCode: 16, name: 'Alger', total: 3, measured: 3, critical: 2, rate: 0.6667, shareOfCritical: 0.6667 },
      { wilayaCode: 31, name: 'Oran', total: 2, measured: 1, critical: 1, rate: 0.5, shareOfCritical: 0.3333 },
    ]);
  });

  test('wilayas without a critical site are not ranked; the global critical count is kept', () => {
    const block = buildWilayaBlock(states);
    expect(block.top.some((w) => w.wilayaCode === 5)).toBe(false);
    expect(block.criticalSites).toBe(3);
  });

  test('shares over all wilayas add up with "unassigned" to the global critical count', () => {
    const withOrphan = [...states, site(345, 99)]; // NeId with 3 digits: no wilaya code, critical
    const block = buildWilayaBlock(withOrphan, { limit: 58 });
    expect(block.criticalSites).toBe(4);
    expect(block.unassigned).toEqual({ sites: 1, critical: 1 });
    const inWilayas = block.top.reduce((a, w) => a + w.critical, 0);
    expect(inWilayas + block.unassigned.critical).toBe(block.criticalSites);
  });

  test('limit, and ties broken by rate then by lower wilaya code', () => {
    const tied = [site(20001, 90), site(20002, 50), site(10001, 90), site(30001, 90), site(40001, 90), site(40002, 90)];
    const { top } = buildWilayaBlock(tied, { limit: 3 });
    // 40 has 2 critical; then 10, 20, 30 have 1 each: 10 and 30 have rate 1, 20 has 0.5
    expect(top.map((w) => w.wilayaCode)).toEqual([40, 10, 30]);
  });

  test('a code outside the 58 wilayas is ranked with a null name', () => {
    const { top } = buildWilayaBlock([site(77001, 90)]);
    expect(top[0]).toMatchObject({ wilayaCode: 77, name: null, critical: 1 });
  });

  test('no site or no critical site: empty ranking, no crash', () => {
    expect(buildWilayaBlock([])).toEqual({ criticalSites: 0, top: [], unassigned: { sites: 0, critical: 0 } });
    expect(buildWilayaBlock([site(16001, 40)]).top).toEqual([]);
  });
});