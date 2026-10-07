const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { importFile, revertImport } = require('../utils/importService');
const { fileTypeOf } = require('../utils/upload');
const { parsePagination } = require('../utils/pagination');
const { findSuccessfulImport, ID_FORMAT } = require('../utils/importLookup');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Site = require('../models/siteModel');
const Measurement = require('../models/measurementModel');



const summarize = (doc) => ({
  id: doc._id,
  fileName: doc.fileName,
  fileType: doc.fileType,
  importedAt: doc.createdAt,
  status: doc.status,
  counts: doc.counts,
  sitesCount: doc.sitesCount,
  periodFrom: doc.periodFrom,
  periodTo: doc.periodTo,
});




const sendPage = (res, { items, key, total, page, limit }) => res.status(200).json({
  status: 'success',
  results: items.length,
  total,
  page,
  pages: Math.ceil(total / limit),
  data: { [key]: items },
});

exports.createImport = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError('Please send a file in the form-data field named "file"', 400, 'UPLOAD_MISSING'));

  const doc = await importFile({
    buffer: req.file.buffer,
    fileName: req.file.originalname,
    fileType: fileTypeOf(req.file.originalname),
    requestId: req.id,
  });

  res.status(201).json({
    status: 'success',
    message: 'Import completed successfully',
    data: { import: summarize(doc) },
  });
});

// DELETE /imports/:id (admin) : cancel an import and remove the data it brought
exports.deleteImport = catchAsync(async (req, res) => {
  if (!ID_FORMAT.test(req.params.id)) throw new AppError(`Invalid import id: ${req.params.id}`, 400);
  const result = await revertImport(req.params.id, { requestId: req.id });
  res.status(200).json({ status: 'success', message: 'Import reverted', data: { id: result.id, removed: result.removed } });
});

// GET /imports : the history screen. Newest first; "number" is the order of arrival (1 = oldest).
exports.getAllImports = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const filter = { status: 'successful' };
  const [total, docs] = await Promise.all([
    Import.countDocuments(filter),
    Import.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
  ]);
  const items = docs.map((d, i) => ({ number: total - skip - i, ...summarize(d) }));
  sendPage(res, { items, key: 'imports', total, page, limit });
});

// GET /imports/:id : summary + issue totals + the days the file covers
exports.getImport = catchAsync(async (req, res) => {
  const doc = await findSuccessfulImport(req.params.id);

  const [number, issueGroups, dayGroups] = await Promise.all([
    Import.countDocuments({ status: 'successful', createdAt: { $lte: doc.createdAt } }),
    ImportIssue.aggregate([
      { $match: { import: doc._id } },
      { $group: { _id: { severity: '$severity', code: '$code' }, n: { $sum: 1 } } },
    ]),
    // Count per (day, status); the totals per day are added up below
    Measurement.aggregate([
      { $match: { import: doc._id } },
      { $group: { _id: { day: '$endTime', status: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);

  const issues = { errors: 0, warnings: 0, byCode: {} };
  issueGroups.forEach((g) => {
    issues[g._id.severity === 'error' ? 'errors' : 'warnings'] += g.n;
    issues.byCode[g._id.code] = g.n;
  });
  const byDay = new Map();
  dayGroups.forEach((g) => {
    const key = g._id.day.getTime();
    const day = byDay.get(key) || { date: g._id.day.toISOString().slice(0, 10), total: 0, valid: 0 };
    day.total += g.n;
    if (g._id.status === 'OK') day.valid += g.n;
    byDay.set(key, day);
  });
  const days = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, d]) => ({ ...d, failed: d.total - d.valid }));

  res.status(200).json({
    status: 'success',
    data: { import: { number, ...summarize(doc), issues, days } },
  });
});

// GET /imports/:id/rows?filter=all|valid|failed&q=<NeId>&page=&limit=
exports.getImportRows = catchAsync(async (req, res) => {
  const doc = await findSuccessfulImport(req.params.id);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

  const filter = { import: doc._id };
  const which = req.query.filter || 'all';
  if (!['all', 'valid', 'failed'].includes(which)) throw new AppError('"filter" must be all, valid or failed', 400);
  if (which === 'valid') filter.status = 'OK';
  if (which === 'failed') filter.status = { $ne: 'OK' };

  if (req.query.q !== undefined) {
    if (!/^\d+$/.test(String(req.query.q))) throw new AppError('"q" must be a NeId (digits only)', 400);
    const sites = await Site.find({ neId: Number(req.query.q) }, '_id').lean();
    filter.site = { $in: sites.map((s) => s._id) };
  }

  const [total, rows] = await Promise.all([
    Measurement.countDocuments(filter),
    Measurement.find(filter)
      .sort({ sourceRow: 1 })
      .skip(skip)
      .limit(limit)
      .populate('site', 'neId neType wilayaCode')
      .populate('link', 'measurePoint portRef label notInUse entityType')
      .lean(),
  ]);

  const items = rows.map((m) => ({
    sourceRow: m.sourceRow,
    neId: m.site.neId,
    neType: m.site.neType,
    wilayaCode: m.site.wilayaCode,
    measurePoint: m.link.measurePoint,
    portRef: m.link.portRef,
    label: m.link.label,
    notInUse: m.link.notInUse,
    entityType: m.link.entityType,
    endTime: m.endTime,
    status: m.status,
    failure: m.failure,
    avgRaw: m.avgRaw,
    maxRaw: m.maxRaw,
    minRaw: m.minRaw,
    bins: m.bins,
    totalSeconds: m.totalSeconds,
    meanUtil: m.meanUtil,
    p95: m.p95,
  }));
  sendPage(res, { items, key: 'rows', total, page, limit });
});

// GET /imports/:id/issues?severity=error|warning&code=<CODE>&page=&limit=
exports.getImportIssues = catchAsync(async (req, res) => {
  const doc = await findSuccessfulImport(req.params.id);
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

  const filter = { import: doc._id };
  if (req.query.severity !== undefined) {
    if (!['error', 'warning'].includes(req.query.severity)) throw new AppError('"severity" must be error or warning', 400);
    filter.severity = req.query.severity;
  }
  if (req.query.code !== undefined) {
    if (!/^[A-Z_]+$/.test(String(req.query.code))) throw new AppError('"code" must be an upper-case issue code', 400);
    filter.code = req.query.code;
  }

  const [total, docs] = await Promise.all([
    ImportIssue.countDocuments(filter),
    ImportIssue.find(filter).sort({ sourceRow: 1, _id: 1 }).skip(skip).limit(limit).lean(),
  ]);
  const items = docs.map((i) => ({ sourceRow: i.sourceRow, severity: i.severity, code: i.code, message: i.message }));
  sendPage(res, { items, key: 'issues', total, page, limit });
});