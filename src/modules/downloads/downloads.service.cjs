/* eslint-env node */
'use strict';

const EntitlementsService = require('../payments/entitlements.service.cjs');

/**
 * Throws if user cannot download the template.
 * MUST be stable in real-server tests:
 * - Prefer injected db (test/app path)
 * - Fallback to repo via EntitlementsService (prod path)
 */
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

  const ok = await EntitlementsService.hasValidEntitlement({ db, userId, templateSlug });
  if (!ok) {
    const err = new Error('NO_ENTITLEMENT');
    err.status = 403;
    err.code = 'NO_ENTITLEMENT';
    throw err;
  }
}

module.exports = { assertCanDownload };
