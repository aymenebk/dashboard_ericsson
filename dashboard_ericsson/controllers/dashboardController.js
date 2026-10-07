const catchAsync = require('../utils/catchAsync');
const { parsePagination } = require('../utils/pagination');
const { parseScope } = require('../utils/scopeParams');
const { computeSiteStates } = require('../utils/dashboardService');
const { buildDashboard } = require('../utils/dashboardBuilder');
const { buildWilayaBlock } = require('../utils/wilayaStats');
const thresholds = require('../config/thresholds');

// GET /dashboard?import=<id>&date=YYYY-MM-DD&limit=10&wilayaLimit=5
exports.getDashboard = catchAsync(async (req, res) => {
  const { limit } = parsePagination({ limit: req.query.limit }, { defaultLimit: 10, maxLimit: 50 });
  const { limit: wilayaLimit } = parsePagination({ limit: req.query.wilayaLimit }, { defaultLimit: 5, maxLimit: 58 });
  const { importId, before, asOf } = await parseScope(req.query);

  const states = await computeSiteStates({ importId, before });
  const dashboard = buildDashboard(states, { limit });
  const { latestUpdate, ...blocks } = dashboard;

  res.status(200).json({
    status: 'success',
    data: {
      scope: { import: importId, asOf, latestUpdate },
      thresholds,
      ...blocks,
      wilayas: buildWilayaBlock(states, { limit: wilayaLimit }),
    },
  });
});