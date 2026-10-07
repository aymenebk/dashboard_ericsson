const ExcelJS = require('exceljs');
const { REQUIRED_COLUMNS } = require('../../utils/excelReader');

// Small synthetic workbook: rows = array of objects keyed by column name
exports.makeXlsx = async (rows, headers = REQUIRED_COLUMNS) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Congestion');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(headers.map((h) => r[h] ?? null)));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

// A valid measured row (all the day in the lowest bin). Override any column.
exports.goodRow = (over = {}) => ({
  NeId: 18870, NeType: 'AMM 20PB', EntityType: 'MLTN WAN Eth Bandwidth RX', MeasurePoint: '1/11/104',
  EndTime: '10/02/2026 00:00:00', Failure: null, Avg: 5, Max: 9, Min: 1,
  ...Object.fromEntries(REQUIRED_COLUMNS.slice(9).map((c, i) => [c, i === 0 ? 86400 : 0])), ...over,
});

// A PM failure row: all bins 0 and a failure message
exports.failureRow = (over = {}) => exports.goodRow({
  Failure: 'PM Failure - NE PM data is invalid',
  ...Object.fromEntries(REQUIRED_COLUMNS.slice(9).map((c) => [c, 0])), ...over,
});

// A valid measured row with the whole day in ONE utilization bin (0..19).
// Resulting P95 = 5 * bin + 4.75 (e.g. bin 0 -> 4.75 good, bin 12 -> 64.75 medium, bin 17 -> 89.75 critical)
exports.rowInBin = (bin, over = {}) => exports.goodRow({
  ...Object.fromEntries(REQUIRED_COLUMNS.slice(9).map((c, i) => [c, i === bin ? 86400 : 0])), ...over,
});