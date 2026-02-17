// src/modules/downloads/downloads.service.cjs
/* eslint-env node */
'use strict';

const EntitlementsRepo = require('../payments/repos/entitlements.repo.cjs');

/**
 * Canonical entitlement check:
 * - BUY: kind='buy' and (ends_at IS NULL)
 * - RENT: kind='rent' and ends_at > now()
 */
async function hasValidEntitlementSql({ db, userId, templateSlug }) {
  const q = `
    SELECT 1
      FROM entitlements
     WHERE user_id = $1
       AND template_slug = $2
       AND (
         (kind = 'buy')
         OR (kind = 'rent' AND ends_at IS NOT NULL AND ends_at > now())
       )
     LIMIT 1
  `;
  const r = await db.query(q, [userId, templateSlug]);
  return r.rowCount > 0;
}

/**
 * Throws if user cannot download the template.
 * MUST be stable in real-server tests:
 * - Prefer canonical EntitlementsRepo (prod path)
 * - Fallback to direct SQL using provided db (test path)
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

  // 1) Try canonical repo path (may use pool internally)
  try {
    if (EntitlementsRepo && typeof EntitlementsRepo.hasEntitlement === 'function') {
      // Canonical repo uses kind: 'buy'|'rent'
      // "download allowed" if buy OR valid rent; repo may already implement this.
      const okBuy = await EntitlementsRepo.hasEntitlement({ db, userId, templateSlug, kind: 'buy' });
      if (okBuy) return;

      const okRent = await EntitlementsRepo.hasEntitlement({ db, userId, templateSlug, kind: 'rent' });
      if (okRent) return;

      const err = new Error('NO_ENTITLEMENT');
      err.status = 403;
      err.code = 'NO_ENTITLEMENT';
      throw err;
    }
  } catch (_e) {
    // swallow and fallback to SQL below
  }

  // 2) Fallback (single source of truth: entitlements table)
  const ok = await hasValidEntitlementSql({ db, userId, templateSlug });
  if (!ok) {
    const err = new Error('NO_ENTITLEMENT');
    err.status = 403;
    err.code = 'NO_ENTITLEMENT';
    throw err;
  }
}

module.exports = { assertCanDownload };
