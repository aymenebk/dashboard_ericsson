const AppError = require('./appError');
const Import = require('../models/importModel');

const ID_FORMAT = /^[a-f0-9]{24}$/i;

// Only successful imports exist for the outside world ("processing" ones are invisible).
async function findSuccessfulImport(id) {
  if (!ID_FORMAT.test(id)) throw new AppError(`Invalid import id: ${id}`, 400);
  const doc = await Import.findOne({ _id: id, status: 'successful' }).lean();
  if (!doc) throw new AppError('No import found with that id', 404);
  return doc;
}

module.exports = { findSuccessfulImport, ID_FORMAT };