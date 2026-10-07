const { parseSiteFilters, listSites, toListItem } = require('../utils/siteList');

const DAY = new Date('2026-02-10T00:00:00Z');
const site = (neId, load, over = {}) => ({
  siteId: `id-${neId}`, neId, neType: 'AMM 20PB', wilayaCode: Math.floor(neId / 1000), load, lastUpdate: DAY, ...over,
});

describe('parseSiteFilters', () => {
  test('defaults: highest load first, no filter', () => {
    expect(parseSiteFilters({})).toEqual({ sort: 'load_desc' });
  });

  test('valid values are parsed (wilaya becomes a number)', () => {
    expect(parseSiteFilters({ neId: '188', wilaya: '21', condition: 'critical', sort: 'load_asc' }))
      .toEqual({ neId: '188', wilaya: 21, condition: 'critical', sort: 'load_asc' });
  });

  test.each([
    [{ neId: 'abc' }], [{ neId: '1234567890' }], [{ neId: '' }], [{ neId: ['1', '2'] }],
    [{ wilaya: '0' }], [{ wilaya: '100' }], [{ wilaya: 'abc' }],
    [{ condition: 'weird' }], [{ condition: ['critical'] }],
    [{ sort: 'sideways' }],
  ])('invalid filter %j is a 400', (query) => {
    expect(() => parseSiteFilters(query)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('listSites', () => {
  const states = [site(1001, 90), site(2002, 65), site(6006, 65), site(3003, 5), site(7007, null), site(4004, null)];
  const ids = (list) => list.map((s) => s.neId);

  test('highest load first; ties by lower NeId; grey sites last', () => {
    expect(ids(listSites(states))).toEqual([1001, 2002, 6006, 3003, 4004, 7007]);
  });

  test('lowest load first: grey sites are STILL last (unknown is neither highest nor lowest)', () => {
    expect(ids(listSites(states, { sort: 'load_asc' }))).toEqual([3003, 2002, 6006, 1001, 4004, 7007]);
  });

  test('each site carries its condition', () => {
    const byId = Object.fromEntries(listSites(states).map((s) => [s.neId, s.condition]));
    expect(byId).toEqual({ 1001: 'critical', 2002: 'medium', 6006: 'medium', 3003: 'good', 4004: 'no_data', 7007: 'no_data' });
  });

  test('neId filter matches the START of the NeId', () => {
    const many = [site(2002, 50), site(20021, 50), site(12002, 50), site(3003, 50)];
    expect(ids(listSites(many, { neId: '20' }))).toEqual([2002, 20021]);
    expect(ids(listSites(many, { neId: '2002' }))).toEqual([2002, 20021]);
    expect(ids(listSites(many, { neId: '3' }))).toEqual([3003]);
  });

  test('wilaya and condition filters, alone and together', () => {
    expect(ids(listSites(states, { wilaya: 2 }))).toEqual([2002]);
    expect(ids(listSites(states, { condition: 'medium' }))).toEqual([2002, 6006]);
    expect(ids(listSites(states, { condition: 'no_data' }))).toEqual([4004, 7007]);
    expect(ids(listSites(states, { wilaya: 6, condition: 'medium' }))).toEqual([6006]);
    expect(ids(listSites(states, { wilaya: 6, condition: 'critical' }))).toEqual([]);
  });

  test('the input is not modified; an empty input gives an empty list', () => {
    const copy = JSON.stringify(states);
    listSites(states, { sort: 'load_asc', condition: 'medium' });
    expect(JSON.stringify(states)).toBe(copy);
    expect(listSites([])).toEqual([]);
  });
});

describe('toListItem', () => {
  test('rounds the load to 2 decimals and adds the wilaya name', () => {
    const [item] = listSites([site(15001, 62.702127659574465)]).map(toListItem);
    expect(item).toEqual({
      siteId: 'id-15001', neId: 15001, neType: 'AMM 20PB', wilayaCode: 15, wilayaName: 'Tizi Ouzou',
      load: 62.7, condition: 'medium', noMeasurementReason: null, lastUpdate: DAY,
    });
  });

  test('a site without measurement keeps a null load', () => {
    const [item] = listSites([site(16001, null)]).map(toListItem);
    expect(item).toMatchObject({ load: null, condition: 'no_data', wilayaName: 'Alger', noMeasurementReason: null });
  });
});