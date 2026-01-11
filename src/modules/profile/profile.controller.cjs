'use strict';

const { listUserEntitlements } = require('../entitlements/entitlements.repo.cjs');

function requireAuth(req) {
  // В твоём проекте auth только cookie.
  // Важно: middleware должен выставлять req.user.
  if (!req.user || !req.user.id) {
    const err = new Error('Unauthorized');
    err.status = 401;
    throw err;
  }
}

async function getMyDownloadsJson(req, res, next) {
  try {
    requireAuth(req);

    const db = req.app.locals.db;
    const userId = req.user.id;

    const items = await listUserEntitlements({ db, userId });
    return res.status(200).json({ items });
  } catch (e) {
    return next(e);
  }
}

async function getProfilePage(req, res, next) {
  try {
    requireAuth(req);

    const db = req.app.locals.db;
    const userId = req.user.id;

    const entitlements = await listUserEntitlements({ db, userId });

    return res.status(200).render('pages/profile', {
      title: 'My Downloads',
      entitlements,
      hasAny: entitlements.length > 0,
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  getMyDownloadsJson,
  getProfilePage,
};
