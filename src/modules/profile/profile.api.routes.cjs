// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const { listUserEntitlements } = require('../entitlements/entitlements.repo.cjs');

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  router.get('/downloads', requireAuth, async (req, res, next) => {
    try {
      const db = req.app.locals.db;

      // auth.middleware.cjs sets either req.user or req.userId
      const userId = (req.user && req.user.id) || req.userId;
      if (!userId) {
        // Safety net (should not happen because requireAuth already handled it)
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
      }

      const items = await listUserEntitlements({ db: req.db, userId: req.user.id });
return res.status(200).json({ items });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
