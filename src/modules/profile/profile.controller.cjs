'use strict';

const { listUserEntitlements } = require('../entitlements/entitlements.repo.cjs');

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

async function getMyDownloadsJson(req, res) {
  // сюда мы попадаем уже после requireAuth (в routes)
  const userId = req.user.id;

  const db = mustGetDb(req);
  const rows = await listUserEntitlements({ db, userId, dealType: 'BUY' });

  res.json({
    items: rows.map((r) => ({
      template_slug: r.template_slug,
      deal_type: r.deal_type,
      created_at: r.created_at,
    })),
  });
}

module.exports = {
  getMyDownloadsJson,
};
