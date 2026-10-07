const { parseEndTime, parseMeasurePoint, toInt, toText } = require('../utils/parsers');
const { wilayaCodeFromNeId } = require('../utils/wilaya');

describe('parseEndTime (dd/mm/yyyy, day first)', () => {
  test('parses a normal value as UTC', () => {
    expect(parseEndTime('10/02/2026 00:00:00').toISOString()).toBe('2026-02-10T00:00:00.000Z');
  });
  test('day-first: 13/02 is February 13th', () => {
    expect(parseEndTime('13/02/2026 00:00:00').toISOString()).toBe('2026-02-13T00:00:00.000Z');
  });
  test('accepts a date without time and a real Date object', () => {
    expect(parseEndTime('15/02/2026').toISOString()).toBe('2026-02-15T00:00:00.000Z');
    const d = new Date('2026-02-10T00:00:00Z');
    expect(parseEndTime(d)).toBe(d);
  });
  test('rejects impossible or malformed dates', () => {
    for (const v of ['31/02/2026 00:00:00', '10/13/2026 00:00:00', '2026-02-10', 'abc', '', null, 5]) {
      expect(parseEndTime(v)).toBeNull();
    }
  });
});

describe('parseMeasurePoint', () => {
  test('port with label and packet links', () => {
    expect(parseMeasurePoint("1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1")).toEqual({
      raw: "1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1",
      portRef: '1/11/106', label: 'To_2238', notInUse: false,
    });
  });
  test('bare port', () => {
    expect(parseMeasurePoint('1/11/104')).toEqual({ raw: '1/11/104', portRef: '1/11/104', label: null, notInUse: false });
  });
  test('detects Not In-Use and keeps truncated raw text', () => {
    const r = parseMeasurePoint("1/11/115 'To_TN1-2219 Not In-Use',PacketLink");
    expect(r.notInUse).toBe(true);
    expect(r.portRef).toBe('1/11/115');
    expect(r.raw.endsWith('PacketLink')).toBe(true);
  });
  test('empty value returns null', () => {
    expect(parseMeasurePoint('  ')).toBeNull();
    expect(parseMeasurePoint(null)).toBeNull();
  });
});

describe('toInt / toText', () => {
  test('toInt accepts integers and numeric strings only', () => {
    expect(toInt(5)).toBe(5);
    expect(toInt(' 42 ')).toBe(42);
    expect(toInt('-3')).toBe(-3);
    for (const v of [1.5, '1.5', 'abc', '', null, undefined, NaN]) expect(toInt(v)).toBeNull();
  });
  test('toText trims and turns empty into null', () => {
    expect(toText('  x ')).toBe('x');
    expect(toText('')).toBeNull();
    expect(toText(null)).toBeNull();
  });
});

describe('wilayaCodeFromNeId (client rule)', () => {
  test.each([[2897, 2], [1016, 1], [18870, 18], [29931, 29], [9999, 9], [10000, 10]])(
    'NeId %i -> wilaya %i', (neId, code) => expect(wilayaCodeFromNeId(neId)).toBe(code),
  );
  test('invalid NeId gives null', () => {
    for (const v of [999, 0, -5, 12.5, '1234', null]) expect(wilayaCodeFromNeId(v)).toBeNull();
  });
});