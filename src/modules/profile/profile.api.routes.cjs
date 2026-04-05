// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const {
  changeMyPasswordJson,
  getMyDownloadsJson,
  getMyProfileJson,
  updateMyProfileJson,
} = require('./profile.controller.cjs');

function profileApiRoutes() {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      return await getMyProfileJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.post('/', requireAuth, express.json(), async (req, res, next) => {
    try {
      return await updateMyProfileJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

  router.post('/password', requireAuth, express.json(), async (req, res, next) => {
    try {
      return await changeMyPasswordJson(req, res);
    } catch (e) {
      return next(e);
    }
  });

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
