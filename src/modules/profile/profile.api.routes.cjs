// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');
const { getMyDownloadsJson } = require('./profile.controller.cjs');

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  router.get('/downloads', getMyDownloadsJson);

  return router;
}

module.exports = { profileApiRoutes };
