const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const AppError = require('./appError');
const { parseEndTime, parseMeasurePoint, toInt, toText } = require('./parsers');
const { wilayaCodeFromNeId } = require('./wilaya');

const BIN_COLUMNS = [
  '0-5', '5-10', '10-15', '15-20', '20-25', '25-30', '30-35', '35-40', '40-45', '45-50',
  '50-55', '55-60', '60-65', '65-70', '70-75', '75-80', '80-85', '85-90', '90-95', '95-100',
];
const TEXT_COLUMNS = ['NeId', 'NeType', 'EntityType', 'MeasurePoint', 'EndTime', 'Failure'];
const NUMBER_COLUMNS = ['Avg', 'Max', 'Min'];
const REQUIRED_COLUMNS = [...TEXT_COLUMNS, ...NUMBER_COLUMNS, ...BIN_COLUMNS];

// Excel cell value -> plain value. Formulas are never evaluated: only the cached result is read.
function plainValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return plainValue(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
    return null;
  }
  return v;
}

function detectDelimiter(buffer) {
  const firstLine = buffer.toString('utf8', 0, 4000).split(/\r?\n/)[0];
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

async function loadWorksheet(buffer, fileType) {
  const workbook = new ExcelJS.Workbook();
  if (fileType === 'csv') {
    const clean = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
    // map: keep every CSV value as text, our own parsers convert them
    await workbook.csv.read(Readable.from(clean), {
      parserOptions: { delimiter: detectDelimiter(clean) },
      map: (v) => (v === '' ? null : v),
    });
  } else {
    await workbook.xlsx.load(buffer);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError('The file contains no sheet', 422, 'EXCEL_NO_SHEET');
  return sheet;
}

// Raw values of one row -> typed row + list of parsing issues. Business rules (sum of bins,
// failure consistency, duplicates) are checked later, in the validator (T4).
function parseRow(get, sourceRow) {
  const issues = [];
  const issue = (code, message) => issues.push({ code, message });

  const neId = toInt(get('NeId'));
  if (neId === null) issue('INVALID_NEID', 'NeId is not an integer');
  const neType = toText(get('NeType'));
  if (!neType) issue('MISSING_NETYPE', 'NeType is empty');
  const measurePoint = parseMeasurePoint(get('MeasurePoint'));
  if (!measurePoint) issue('MISSING_MEASUREPOINT', 'MeasurePoint is empty');
  const endTime = parseEndTime(get('EndTime'));
  if (!endTime) issue('INVALID_ENDTIME', `EndTime "${get('EndTime')}" is not dd/mm/yyyy hh:mm:ss`);

  const numbers = {};
  NUMBER_COLUMNS.forEach((c) => {
    numbers[c] = toInt(get(c));
    if (numbers[c] === null) issue('INVALID_NUMBER', `${c} is not an integer`);
  });
  const bins = BIN_COLUMNS.map((c) => {
    const n = toInt(get(c));
    if (n === null) issue('INVALID_NUMBER', `Column ${c} is not an integer`);
    return n;
  });

  return {
    sourceRow,
    neId,
    neType,
    wilayaCode: neId === null ? null : wilayaCodeFromNeId(neId),
    entityType: toText(get('EntityType')),
    measurePoint,
    endTime,
    failure: toText(get('Failure')),
    avgRaw: numbers.Avg,
    maxRaw: numbers.Max,
    minRaw: numbers.Min,
    bins,
    issues,
  };
}

/**
 * Reads an uploaded workbook or CSV (Buffer). Columns are located by header name, never by position.
 * Returns { rows } or throws an AppError (422) if a required column is missing.
 */
async function readImportFile(buffer, fileType = 'xlsx') {
  if (!['xlsx', 'csv'].includes(fileType)) throw new AppError('Only .xlsx and .csv files are supported', 415, 'UNSUPPORTED_FILE_TYPE');

  let sheet;
  try {
    sheet = await loadWorksheet(buffer, fileType);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('The file could not be read. Is it a valid Excel or CSV file?', 422, 'EXCEL_UNREADABLE');
  }

  const columnIndex = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const name = toText(plainValue(cell.value));
    if (name && !(name in columnIndex)) columnIndex[name] = col;
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in columnIndex));
  if (missing.length) {
    throw new AppError(`Required column(s) missing: ${missing.join(', ')}`, 422, 'EXCEL_MISSING_COLUMNS', { missing });
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (name) => plainValue(row.getCell(columnIndex[name]).value);
    if (REQUIRED_COLUMNS.every((c) => get(c) === null)) return; // fully empty row
    rows.push(parseRow(get, rowNumber));
  });
  return { rows };
}

module.exports = { readImportFile, REQUIRED_COLUMNS, BIN_COLUMNS };