// src/modules/profile/profile.api.routes.cjs
'use strict';

const express = require('express');

const { requireAuth } = require('../../middlewares/auth.middleware.cjs');
const EntitlementsRepo = require('../payments/repos/entitlements.repo.cjs');

async function listBuysSql({ db, userId }) {
  // Keep stable contract for tests/UI:
  // return BUY items only
  const q = `
    SELECT template_slug, 'BUY'::text AS deal_type, created_at
      FROM entitlements
     WHERE user_id = $1
       AND kind = 'buy'
     ORDER BY created_at DESC
  `;
  const r = await db.query(q, [userId]);
  return r.rows;
}

function profileApiRoutes() {
  const router = express.Router();

  // GET /api/profile/downloads
  router.get('/downloads', requireAuth, async (req, res, next) => {
    try {
      const db = req.db || req.app.locals.db;

      const userId = (req.user && req.user.id) || req.userId;
      if (!userId) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
      }

      // 1) Try canonical repo (prod path)
      try {
        if (EntitlementsRepo && typeof EntitlementsRepo.listUserEntitlements === 'function') {
          const rows = await EntitlementsRepo.listUserEntitlements({ db, userId });

          const items = (rows || [])
            .map((r) => ({
              template_slug: r.template_slug,
              deal_type: r.kind === 'rent' ? 'RENT' : 'BUY',
              created_at: r.created_at,
            }))
            .filter((x) => x.deal_type === 'BUY');

          return res.status(200).json({ items });
        }
      } catch (_e) {
        // swallow and fallback below
      }

      // 2) Fallback SQL (single source of truth table)
      const items = await listBuysSql({ db, userId });
      return res.status(200).json({ items });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}

module.exports = { profileApiRoutes };
