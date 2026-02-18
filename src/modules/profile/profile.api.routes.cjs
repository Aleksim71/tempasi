// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const { getMyDownloadsJson } = require('./profile.controller.cjs');

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  // Stable contract for tests/UI:
  // - returns BUY items only (implemented in controller)
  router.get('/downloads', requireAuth, async (req, res, next) => {
    try {
      return await getMyDownloadsJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
