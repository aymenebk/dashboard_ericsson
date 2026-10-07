const express = require('express');
const siteController = require('../controllers/siteController');

const router = express.Router();

router.get('/', siteController.getAllSites);
router.get('/:id', siteController.getSite);

module.exports = router;