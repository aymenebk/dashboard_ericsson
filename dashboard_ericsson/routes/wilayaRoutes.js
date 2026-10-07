const express = require('express');
const wilayaController = require('../controllers/wilayaController');

const router = express.Router();

router.get('/', wilayaController.getWilayas);

module.exports = router;