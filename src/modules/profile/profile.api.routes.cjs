'use strict';

const express = require('express');
const { listUserEntitlements } = require('../entitlements/entitlements.repo.cjs');

function requireAuth(req) {
  if (!req.user || !req.user.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  router.get('/downloads', async (req, res, next) => {
    try {
      requireAuth(req);

      const db = req.app.locals.db;
      const userId = req.user.id;

      const items = await listUserEntitlements({ db, userId });
      return res.status(200).json({ items });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
