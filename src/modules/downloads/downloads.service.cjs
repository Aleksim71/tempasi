/* eslint-env node */
'use strict';

const EntitlementsService = require('../payments/entitlements.service.cjs');

async function assertCanDownload({ db, userId, templateSlug }) {
  if (!db || typeof db.query !== 'function') {
    const err = new Error('DB_NOT_WIRED');
    err.status = 500;
    err.code = 'DB_NOT_WIRED';
    throw err;
  }

  if (!userId || !templateSlug) {
    const err = new Error('BAD_ARGS');
    err.status = 400;
    err.code = 'BAD_ARGS';
    throw err;
  }

  let ok = false;

  if (typeof EntitlementsService.hasValidEntitlement === 'function') {
    ok = await EntitlementsService.hasValidEntitlement({ db, userId, templateSlug });
  } else if (typeof EntitlementsService.hasActiveEntitlement === 'function') {
    ok = await EntitlementsService.hasActiveEntitlement(userId, templateSlug);
  } else {
    const err = new Error('ENTITLEMENTS_CHECK_NOT_AVAILABLE');
    err.status = 500;
    err.code = 'ENTITLEMENTS_CHECK_NOT_AVAILABLE';
    throw err;
  }

  if (!ok) {
    const err = new Error('NO_ENTITLEMENT');
    err.status = 403;
    err.code = 'NO_ENTITLEMENT';
    throw err;
  }
}

module.exports = { assertCanDownload };
