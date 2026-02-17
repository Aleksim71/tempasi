// src/modules/profile/profile.controller.cjs
'use strict';

const EntitlementsRepo = require('../payments/repos/entitlements.repo.cjs');

function mustGetDb(req) {
  const db = req.app && req.app.locals && req.app.locals.db;
  if (!db || typeof db.query !== 'function') {
    const err = new Error('[profile] DB is not attached to app.locals.db');
    err.status = 500;
    err.code = 'DB_NOT_READY';
    throw err;
  }
  return db;
}

/**
 * Returns list of downloadable templates for current user.
 * Canonical source: payments/repos/entitlements.repo.cjs
 *
 * Output contract (stable for UI/tests):
 * { items: [{ template_slug, deal_type, created_at }] }
 *
 * Note:
 * Canonical entitlements use `kind` ('buy'|'rent') and ends_at, not `deal_type`.
 * We map `kind` -> `deal_type` for backwards compatibility.
 */
async function getMyDownloadsJson(req, res) {
  // сюда мы попадаем уже после requireAuth (в routes)
  const userId = req.user.id;

  const db = mustGetDb(req);

  // Canonical list (includes buy + rent; we map to deal_type)
  const rows = await EntitlementsRepo.listUserEntitlements({ db, userId });

  const items = (rows || [])
    .map((r) => ({
      template_slug: r.template_slug,
      deal_type: r.kind === 'rent' ? 'RENT' : 'BUY',
      created_at: r.created_at,
    }))
    // keep previous behavior: downloads list == BUY items
    .filter((x) => x.deal_type === 'BUY');

  return res.json({ items });
}

module.exports = {
  getMyDownloadsJson,
};
