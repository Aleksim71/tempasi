// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const EntitlementsRepo = require('../payments/repos/entitlements.repo.cjs');

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  router.get('/downloads', requireAuth, async (req, res, next) => {
    try {
      const db = req.db || req.app.locals.db;

      // auth.middleware.cjs sets either req.user or req.userId
      const userId = (req.user && req.user.id) || req.userId;
      if (!userId) {
        // Safety net (should not happen because requireAuth already handled it)
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
      }

      const rows = await EntitlementsRepo.listUserEntitlements({ db, userId });

      // Keep response contract stable for UI/tests:
      // - return only BUY downloads
      // - map canonical kind -> legacy deal_type
      const items = (rows || [])
        .map((r) => ({
          template_slug: r.template_slug,
          deal_type: r.kind === 'rent' ? 'RENT' : 'BUY',
          created_at: r.created_at,
        }))
        .filter((x) => x.deal_type === 'BUY');

      return res.status(200).json({ items });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
