const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { readImportFile, REQUIRED_COLUMNS, BIN_COLUMNS } = require('../utils/excelReader');

const goodBins = () => [86400, ...new Array(19).fill(0)];

async function makeXlsx(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Congestion');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const rowFor = (headers, values) => headers.map((h) => values[h] ?? null);
const baseValues = () => ({
  NeId: 18870, NeType: 'AMM 20PB', EntityType: 'MLTN WAN Eth Bandwidth RX',
  MeasurePoint: "1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1", EndTime: '10/02/2026 00:00:00',
  Failure: null, Avg: 435, Max: 73998, Min: 101,
  ...Object.fromEntries(BIN_COLUMNS.map((c, i) => [c, goodBins()[i]])),
});

describe('readImportFile on small generated files', () => {
  test('reads a row and parses every field', async () => {
    const buf = await makeXlsx(REQUIRED_COLUMNS, [rowFor(REQUIRED_COLUMNS, baseValues())]);
    const { rows } = await readImportFile(buf, 'xlsx');
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.sourceRow).toBe(2);
    expect(r.neId).toBe(18870);
    expect(r.wilayaCode).toBe(18);
    expect(r.endTime.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(r.measurePoint.portRef).toBe('1/11/106');
    expect(r.failure).toBeNull();
    expect(r.bins).toHaveLength(20);
    expect(r.issues).toEqual([]);
  });

  test('columns are found by name, whatever their order', async () => {
    const shuffled = [...REQUIRED_COLUMNS].reverse();
    const buf = await makeXlsx(shuffled, [rowFor(shuffled, baseValues())]);
    const { rows } = await readImportFile(buf, 'xlsx');
    expect(rows[0].neId).toBe(18870);
    expect(rows[0].bins[0]).toBe(86400);
  });

  test('a missing column is rejected with a 422 naming it', async () => {
    const headers = REQUIRED_COLUMNS.filter((c) => c !== '90-95');
    const buf = await makeXlsx(headers, [rowFor(headers, baseValues())]);
    await expect(readImportFile(buf, 'xlsx')).rejects.toMatchObject({
      statusCode: 422, message: expect.stringContaining('90-95'),
    });
  });

  test('bad cells become issues, the row is still returned', async () => {
    const v = { ...baseValues(), NeId: 'abc', EndTime: '31/02/2026 00:00:00', '5-10': 1.5 };
    const buf = await makeXlsx(REQUIRED_COLUMNS, [rowFor(REQUIRED_COLUMNS, v)]);
    const codes = (await readImportFile(buf, 'xlsx')).rows[0].issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['INVALID_NEID', 'INVALID_ENDTIME', 'INVALID_NUMBER']));
  });

  test('a failure row keeps its message', async () => {
    const v = { ...baseValues(), Failure: 'PM Failure - NE not reachable' };
    const buf = await makeXlsx(REQUIRED_COLUMNS, [rowFor(REQUIRED_COLUMNS, v)]);
    expect((await readImportFile(buf, 'xlsx')).rows[0].failure).toBe('PM Failure - NE not reachable');
  });

  test('formula cells are read as their cached value only', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(REQUIRED_COLUMNS);
    const values = rowFor(REQUIRED_COLUMNS, baseValues());
    values[REQUIRED_COLUMNS.indexOf('Avg')] = { formula: '1+1', result: 2 };
    ws.addRow(values);
    const { rows } = await readImportFile(Buffer.from(await wb.xlsx.writeBuffer()), 'xlsx');
    expect(rows[0].avgRaw).toBe(2);
  });

  test('empty rows are skipped', async () => {
    const buf = await makeXlsx(REQUIRED_COLUMNS, [
      rowFor(REQUIRED_COLUMNS, baseValues()), new Array(REQUIRED_COLUMNS.length).fill(null),
    ]);
    expect((await readImportFile(buf, 'xlsx')).rows).toHaveLength(1);
  });

  test('garbage bytes give a clean 422, not a crash', async () => {
    await expect(readImportFile(Buffer.from('not an excel file'), 'xlsx')).rejects.toMatchObject({ statusCode: 422 });
  });

  test('unsupported type gives 415', async () => {
    await expect(readImportFile(Buffer.from(''), 'pdf')).rejects.toMatchObject({ statusCode: 415 });
  });
});

describe('readImportFile on CSV', () => {
  const csvLine = (values, sep) => REQUIRED_COLUMNS
    .map((h) => {
      const s = values[h] === null || values[h] === undefined ? '' : String(values[h]);
      return /[;,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(sep);

  test.each([[','], [';']])('delimiter "%s" is detected, quoted commas survive', async (sep) => {
    const text = `\uFEFF${REQUIRED_COLUMNS.join(sep)}\r\n${csvLine(baseValues(), sep)}\r\n`;
    const { rows } = await readImportFile(Buffer.from(text, 'utf8'), 'csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].neId).toBe(18870);
    expect(rows[0].measurePoint.raw).toBe("1/11/106 'To_2238',PacketLinks=1/17/1,1/18/1");
    expect(rows[0].endTime.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(rows[0].bins[0]).toBe(86400);
    expect(rows[0].issues).toEqual([]);
  });
});

// Real workbook: lives in dev-data/ (never committed). Skipped when absent.
const REAL = path.join(__dirname, '..', 'dev-data', 'congestion_data.xlsx');
(fs.existsSync(REAL) ? describe : describe.skip)('real workbook (dev-data/congestion_data.xlsx)', () => {
  let rows;
  beforeAll(async () => { rows = (await readImportFile(fs.readFileSync(REAL), 'xlsx')).rows; });

  test('1200 rows, no parsing issue', () => {
    expect(rows).toHaveLength(1200);
    expect(rows.filter((r) => r.issues.length)).toHaveLength(0);
  });
  test('failures: 862 empty, 184 not reachable, 154 invalid', () => {
    expect(rows.filter((r) => r.failure === null)).toHaveLength(862);
    expect(rows.filter((r) => r.failure === 'PM Failure - NE not reachable')).toHaveLength(184);
    expect(rows.filter((r) => r.failure === 'PM Failure - NE PM data is invalid')).toHaveLength(154);
  });
  test('sum of bins: 86400 on valid rows, 0 on failure rows', () => {
    const sum = (r) => r.bins.reduce((a, b) => a + b, 0);
    expect(rows.filter((r) => r.failure === null).every((r) => sum(r) === 86400)).toBe(true);
    expect(rows.filter((r) => r.failure !== null).every((r) => sum(r) === 0)).toBe(true);
  });
  test('period 10 to 15 Feb 2026, 200 rows per day', () => {
    const perDay = {};
    rows.forEach((r) => { const k = r.endTime.toISOString().slice(0, 10); perDay[k] = (perDay[k] || 0) + 1; });
    expect(perDay).toEqual({
      '2026-02-10': 200, '2026-02-11': 200, '2026-02-12': 200,
      '2026-02-13': 200, '2026-02-14': 200, '2026-02-15': 200,
    });
  });
  test('1200 distinct (NeId, MeasurePoint, EndTime), 1194 distinct (NeId, NeType)', () => {
    expect(new Set(rows.map((r) => `${r.neId}|${r.measurePoint.raw}|${r.endTime.toISOString()}`)).size).toBe(1200);
    expect(new Set(rows.map((r) => `${r.neId}|${r.neType}`)).size).toBe(1194);
  });
  test('wilaya codes all between 1 and 29', () => {
    const codes = rows.map((r) => r.wilayaCode);
    expect(Math.min(...codes)).toBe(1);
    expect(Math.max(...codes)).toBe(29);
  });
});