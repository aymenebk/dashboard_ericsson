const express = require('express');
const importController = require('../controllers/importController');
const { restrictTo } = require('../controllers/authController');
const { uploadSingleFile } = require('../utils/upload');

const router = express.Router();

// app.js already requires a valid token. Reading is open to any logged-in role; importing and reverting are admin only.
router
  .route('/')
  .get(importController.getAllImports)
  .post(restrictTo('admin'), uploadSingleFile, importController.createImport);
router.route('/:id').get(importController.getImport).delete(restrictTo('admin'), importController.deleteImport);
router.get('/:id/rows', importController.getImportRows);
router.get('/:id/issues', importController.getImportIssues);

module.exports = router;