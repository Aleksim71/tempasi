'use strict';

const express = require('express');
const router = express.Router();

const DownloadsController = require('./downloads.controller.cjs');

// GET /download/:slug
router.get('/:slug', (req, res, next) => {
  DownloadsController.downloadZip(req, res).catch(next);
});

module.exports = router;
