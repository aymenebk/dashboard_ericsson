const crypto = require('crypto');
const AppError = require('./appError');
const logger = require('./logger');
const { readImportFile } = require('./excelReader');
const { validateRows } = require('./rowValidator');
const { buildImportPlan } = require('./importPlanner');
const Import = require('../models/importModel');
const ImportIssue = require('../models/importIssueModel');
const Site = require('../models/siteModel');
const Link = require('../models/linkModel');
const Measurement = require('../models/measurementModel');

const CHUNK = 5000;
const REVERT_STALE_MS = 5 * 60 * 1000; // a "reverting" import untouched for this long is considered abandoned
const chunks = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

// Undo everything a failed import wrote. Sites and links are removed only if THIS import created them
// AND nothing refers to them any more (a concurrent import may have started to use them meanwhile).
async function rollback(importId, created) {
  await Promise.all([Measurement.deleteMany({ import: importId }), ImportIssue.deleteMany({ import: importId })]);
  if (created.linkIds.length) {
    const used = new Set((await Measurement.distinct('link', { link: { $in: created.linkIds } })).map(String));
    const orphans = created.linkIds.filter((id) => !used.has(String(id)));
    if (orphans.length) await Link.deleteMany({ _id: { $in: orphans } });
  }
  if (created.siteIds.length) {
    const used = new Set((await Link.distinct('site', { site: { $in: created.siteIds } })).map(String));
    const orphans = created.siteIds.filter((id) => !used.has(String(id)));
    if (orphans.length) await Site.deleteMany({ _id: { $in: orphans } });
  }
  await Import.deleteOne({ _id: importId });
}

// Sites and links: look up the ones that already exist, insert only the missing ones.
// (One insertMany is far faster than thousands of upserts, and tells us exactly what we created.)
async function ensureSites(plan, created) {
  const neIds = [...new Set(plan.sites.map((s) => s.neId))];
  const found = await Site.find({ neId: { $in: neIds } }, 'neId neType').lean();
  const idByKey = new Map(found.map((s) => [`${s.neId}|${s.neType}`, s._id]));

  const missing = plan.sites.filter((s) => !idByKey.has(`${s.neId}|${s.neType}`));
  for (const part of chunks(missing)) {
    const inserted = await Site.insertMany(part);
    inserted.forEach((doc) => {
      idByKey.set(`${doc.neId}|${doc.neType}`, doc._id);
      created.siteIds.push(doc._id);
    });
  }
  return idByKey;
}

async function ensureLinks(plan, siteIdByKey, created) {
  const found = await Link.find({ site: { $in: [...new Set(siteIdByKey.values())] } }, 'site measurePoint').lean();
  const idByKey = new Map(found.map((l) => [`${l.site}|${l.measurePoint}`, l._id]));

  const missing = plan.links.filter((l) => !idByKey.has(`${siteIdByKey.get(l.siteKey)}|${l.measurePoint}`));
  for (const part of chunks(missing)) {
    const inserted = await Link.insertMany(
      part.map((l) => ({
        site: siteIdByKey.get(l.siteKey),
        measurePoint: l.measurePoint,
        portRef: l.portRef,
        label: l.label,
        notInUse: l.notInUse,
        entityType: l.entityType,
      })),
    );
    inserted.forEach((doc) => {
      idByKey.set(`${doc.site}|${doc.measurePoint}`, doc._id);
      created.linkIds.push(doc._id);
    });
  }
  return idByKey;
}

/**
 * Whole import in one step. Either it succeeds and the data is complete,
 * or it fails and nothing is left behind (a failed import never appears in the history).
 */
async function importFile({ buffer, fileName, fileType, requestId }) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const already = await Import.findOne({ sha256 }).lean();
  if (already) {
    throw new AppError(
      `This file was already imported on ${already.createdAt.toISOString()} (import ${already._id})`,
      409,
      'IMPORT_DUPLICATE_FILE',
      { importId: String(already._id), importedAt: already.createdAt },
    );
  }
  let importDoc;
  try {
    importDoc = await Import.create({ fileName, fileType, fileSize: buffer.length, sha256 });
  } catch (err) {
    if (err.code === 11000) throw new AppError('This file is already being imported', 409, 'IMPORT_IN_PROGRESS');
    throw err;
  }
  logger.info('import started', { requestId, importId: String(importDoc._id), fileName, fileType, fileSize: buffer.length, sha256 });

  const created = { siteIds: [], linkIds: [] };
  try {
    const { rows } = await readImportFile(buffer, fileType);
    if (rows.length === 0) throw new AppError('The file contains no data rows', 422, 'IMPORT_EMPTY_FILE');

    const { results, summary } = validateRows(rows);
    const plan = buildImportPlan(results);
    if (plan.entries.length === 0) throw new AppError(`No valid row found: all ${rows.length} rows were rejected`, 422, 'IMPORT_ALL_ROWS_REJECTED');

    const siteIdByKey = await ensureSites(plan, created);
    const linkIdByKey = await ensureLinks(plan, siteIdByKey, created);
    const siteOf = (e) => siteIdByKey.get(e.siteKey);
    const linkByKey = new Map(plan.links.map((l) => [l.key, l]));
    const linkOf = (e) => linkIdByKey.get(`${siteOf(e)}|${linkByKey.get(e.linkKey).measurePoint}`);

    // Rows whose (link, day) already exists from an earlier import are skipped, not overwritten
    const linkIdOfEntry = new Map(plan.entries.map((e) => [e, linkOf(e)]));
    const days = [...new Set(plan.entries.map((e) => e.result.row.endTime.getTime()))].map((t) => new Date(t));
    const existing = await Measurement.find(
      { link: { $in: [...new Set(linkIdOfEntry.values())] }, endTime: { $in: days } },
      'link endTime',
    ).lean();
    const existingKeys = new Set(existing.map((m) => `${m.link}|${m.endTime.getTime()}`));

    const toStore = [];
    const skipped = [];
    plan.entries.forEach((e) => {
      const key = `${linkIdOfEntry.get(e)}|${e.result.row.endTime.getTime()}`;
      (existingKeys.has(key) ? skipped : toStore).push(e);
    });
    if (toStore.length === 0) {
      throw new AppError(`Nothing new to import: all ${skipped.length} rows were already imported`, 409, 'IMPORT_NOTHING_NEW');
    }

    const docs = toStore.map((e) => {
      const { row, status, metrics } = e.result;
      return {
        import: importDoc._id,
        sourceRow: row.sourceRow,
        site: siteOf(e),
        link: linkIdOfEntry.get(e),
        endTime: row.endTime,
        status,
        failure: row.failure,
        avgRaw: row.avgRaw,
        maxRaw: row.maxRaw,
        minRaw: row.minRaw,
        bins: row.bins,
        ...(status === 'OK'
          ? { totalSeconds: metrics.totalSeconds, tailSeconds: metrics.tailSeconds, meanUtil: metrics.meanUtil, p95: metrics.p95 }
          : {}),
      };
    });
    for (const part of chunks(docs)) await Measurement.insertMany(part);

    logger.info('import prepared', {
      requestId,
      importId: String(importDoc._id),
      rows: rows.length,
      sites: plan.sites.length,
      links: plan.links.length,
      toStore: toStore.length,
      skipped: skipped.length,
      rejected: summary.rejected,
    });

    const issues = [
      ...plan.issues,
      ...skipped.map((e) => ({
        sourceRow: e.result.sourceRow,
        severity: 'warning',
        code: 'DUPLICATE_OF_EXISTING',
        message: 'A measurement already exists for this link and day: row skipped',
      })),
    ].map((i) => ({ import: importDoc._id, sourceRow: i.sourceRow, severity: i.severity, code: i.code, message: i.message }));
    for (const part of chunks(issues)) await ImportIssue.insertMany(part);

    // reduce, not Math.min(...list): spreading 100k+ values would overflow the call stack
    let first = Infinity;
    let last = -Infinity;
    toStore.forEach((e) => {
      const t = e.result.row.endTime.getTime();
      if (t < first) first = t;
      if (t > last) last = t;
    });
    importDoc.counts = {
      rowsTotal: rows.length,
      valid: toStore.filter((e) => e.result.status === 'OK').length,
      failed: toStore.filter((e) => e.result.status !== 'OK').length,
      rejected: summary.rejected,
      skipped: skipped.length,
      withWarnings: toStore.filter((e) => e.result.issues.length > 0).length,
    };
    importDoc.sitesCount = new Set(toStore.map((e) => e.siteKey)).size;
    importDoc.periodFrom = new Date(first);
    importDoc.periodTo = new Date(last);
    importDoc.status = 'successful';
    await importDoc.save();
    logger.info('import committed', { requestId, importId: String(importDoc._id), counts: importDoc.counts, sites: importDoc.sitesCount });
    return importDoc;
  } catch (err) {
    logger.warn('import failed, rolling back', { requestId, importId: String(importDoc._id), code: err.code, message: err.isOperational ? err.message : 'unexpected error' });
    try {
      await rollback(importDoc._id, created);
    } catch (rollbackErr) {
      logger.error('import rollback failed: the import is left in "processing"', { requestId, importId: String(importDoc._id), error: logger.describeError(rollbackErr) });
    }
    throw err;
  }
}

/**
 * Cancels a successful import and removes what it brought: its measurements and issues, then the links
 * and sites that no measurement of ANY import uses any more (data of earlier imports is never touched).
 *
 * Safe to call twice or in parallel: the import is claimed atomically (successful -> reverting), so only
 * one caller does the work; the others get 404 (already gone) or 409 (being reverted right now).
 * Partial failure: every step is idempotent and the import stays hidden in "reverting"; calling DELETE
 * again (after REVERT_STALE_MS) resumes where it stopped. No transactions on purpose: they need a replica
 * set, and the docker-compose MongoDB is a standalone server.
 */
async function revertImport(id, { requestId } = {}) {
  let doc = await Import.findOneAndUpdate({ _id: id, status: 'successful' }, { status: 'reverting' }, { returnDocument: 'after' }).lean();
  if (!doc) {
    const current = await Import.findById(id, 'status updatedAt').lean();
    if (!current) throw new AppError('No import found with that id', 404);
    if (current.status === 'processing') throw new AppError('This import is still being processed', 409, 'IMPORT_IN_PROGRESS');
    // "reverting": a previous revert did not finish (or is running right now). Resume it only if it looks abandoned.
    if (Date.now() - current.updatedAt.getTime() < REVERT_STALE_MS) {
      throw new AppError('This import is already being reverted', 409, 'IMPORT_REVERT_IN_PROGRESS');
    }
    doc = await Import.findOneAndUpdate(
      { _id: id, status: 'reverting', updatedAt: current.updatedAt },
      { $currentDate: { updatedAt: true } },
      { returnDocument: 'after' },
    ).lean();
    if (!doc) throw new AppError('This import is already being reverted', 409, 'IMPORT_REVERT_IN_PROGRESS');
  }
  logger.info('import revert started', { requestId, importId: String(doc._id), fileName: doc.fileName });

  try {
    // Which links/sites did this import touch? Written down BEFORE its measurements disappear: after a
    // crash the measurements are gone, but the list is still there.
    const saved = await Import.findById(doc._id).select('+revertLinks +revertSites').lean();
    let { revertLinks: linkIds, revertSites: siteIds } = saved;
    if (!linkIds || !siteIds) {
      [linkIds, siteIds] = await Promise.all([
        Measurement.distinct('link', { import: doc._id }),
        Measurement.distinct('site', { import: doc._id }),
      ]);
      await Import.updateOne({ _id: doc._id }, { $set: { revertLinks: linkIds, revertSites: siteIds } });
    }
    const measurements = await Measurement.deleteMany({ import: doc._id });
    const issues = await ImportIssue.deleteMany({ import: doc._id });

    // A link (then a site) is an orphan when nothing refers to it any more
    const usedLinks = new Set((await Measurement.distinct('link', { link: { $in: linkIds } })).map(String));
    const orphanLinks = linkIds.filter((l) => !usedLinks.has(String(l)));
    const links = orphanLinks.length ? await Link.deleteMany({ _id: { $in: orphanLinks } }) : { deletedCount: 0 };

    const usedSites = new Set((await Link.distinct('site', { site: { $in: siteIds } })).map(String));
    const orphanSites = siteIds.filter((s) => !usedSites.has(String(s)));
    const sites = orphanSites.length ? await Site.deleteMany({ _id: { $in: orphanSites } }) : { deletedCount: 0 };

    await Import.deleteOne({ _id: doc._id }); // last: it frees the fingerprint, the same file can be imported again
    const removed = { measurements: measurements.deletedCount, issues: issues.deletedCount, links: links.deletedCount, sites: sites.deletedCount };
    logger.info('import reverted', { requestId, importId: String(doc._id), removed });
    return { id: doc._id, removed };
  } catch (err) {
    logger.error('import revert failed: the import stays in "reverting", call DELETE again to finish', { requestId, importId: String(doc._id), error: logger.describeError(err) });
    throw err;
  }
}

module.exports = { importFile, revertImport };