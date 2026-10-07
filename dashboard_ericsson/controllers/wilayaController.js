const catchAsync = require('../utils/catchAsync');
const Site = require('../models/siteModel');
const { WILAYAS } = require('../config/wilayas');

// GET /wilayas : the wilayas that contain at least one site (for the "All wilayas" filter)
exports.getWilayas = catchAsync(async (req, res) => {
  const groups = await Site.aggregate([{ $group: { _id: '$wilayaCode', sites: { $sum: 1 } } }]);

  const wilayas = groups
    .filter((g) => g._id !== null && g._id !== undefined)
    .map((g) => ({ code: g._id, name: WILAYAS[g._id] || null, sites: g.sites }))
    .sort((a, b) => a.code - b.code);
  const unassigned = (groups.find((g) => g._id === null || g._id === undefined) || { sites: 0 }).sites;

  res.status(200).json({
    status: 'success',
    results: wilayas.length,
    data: { wilayas, unassignedSites: unassigned },
  });
});