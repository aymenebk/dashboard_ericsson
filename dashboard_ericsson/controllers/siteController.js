const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { parsePagination } = require('../utils/pagination');
const { ID_FORMAT } = require('../utils/importLookup');
const { parseScope } = require('../utils/scopeParams');
const { computeSiteStates } = require('../utils/dashboardService');
const { parseSiteFilters, listSites, toListItem } = require('../utils/siteList');
const { buildSiteDetail } = require('../utils/siteDetail');
const thresholds = require('../config/thresholds');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Measurement = require('../models/measurementModel');

// GET /sites?neId=&wilaya=&condition=&sort=load_desc|load_asc&date=&import=&page=&limit=
exports.getAllSites = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 200 });
  const filters = parseSiteFilters(req.query);
  const { importId, before, asOf } = await parseScope(req.query);

  const states = await computeSiteStates({ importId, before });
  const all = listSites(states, filters);
  const sites = all.slice(skip, skip + limit).map(toListItem);

  res.status(200).json({
    status: 'success',
    results: sites.length,
    total: all.length,
    page,
    pages: Math.ceil(all.length / limit),
    from: sites.length ? skip + 1 : 0, // "showing 1-100"
    to: skip + sites.length,
    data: { scope: { import: importId, asOf }, thresholds, sites },
  });
});

// GET /sites/:id?date=&import=  (:id is the siteId returned by the list)
exports.getSite = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (!ID_FORMAT.test(id)) throw new AppError(`Invalid site id: ${id}`, 400);
  const { importId, before, asOf } = await parseScope(req.query);

  const site = await Site.findById(id).lean();
  if (!site) throw new AppError('No site found with that id', 404);

  const filter = { site: site._id };
  if (importId) filter.import = importId;
  if (before) filter.endTime = { $lt: before };
  const measurements = await Measurement.find(filter, 'link endTime status p95 failure bins').sort({ endTime: -1 }).lean();
  if (measurements.length === 0) throw new AppError('No measurement for this site in the requested scope', 404);

  const links = await Link.find({ _id: { $in: [...new Set(measurements.map((m) => String(m.link)))] } }).lean();
  const detail = buildSiteDetail({ site, links, measurements });

  res.status(200).json({
    status: 'success',
    data: { scope: { import: importId, asOf }, thresholds, ...detail },
  });
});