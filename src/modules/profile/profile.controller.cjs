// src/modules/profile/profile.controller.cjs
'use strict';

const EntitlementsService = require('../payments/entitlements.service.cjs');

function mustGetDb(req) {
  // Prefer req.db (used in tests/realServer helper), fallback to app.locals.db (prod app)
  const db =
    (req && req.db) || (req && req.app && req.app.locals && req.app.locals.db);

  if (!db || typeof db.query !== 'function') {
    const err = new Error('[profile] DB is not attached (expected req.db or app.locals.db)');
    err.status = 500;
    err.code = 'DB_NOT_READY';
    throw err;
  }
  return db;
}

/**
 * Returns list of downloadable templates for current user.
 *
 * Output contract (stable for UI/tests):
 * { items: [{ template_slug, deal_type, created_at }] }
 *
 * Previous behavior: downloads list == BUY items only.
 */
async function getMyDownloadsJson(req, res) {
  const userId = req.user.id;
  const db = mustGetDb(req);

  const rows = await EntitlementsService.listUserEntitlements({ db, userId });

  const items = (rows || [])
    .map((r) => ({
      template_slug: r.template_slug,
      deal_type: r.kind === 'rent' ? 'RENT' : 'BUY',
      created_at: r.created_at,
    }))
    .filter((x) => x.deal_type === 'BUY');

  return res.json({ items });
}

module.exports = {
  getMyDownloadsJson,
};
