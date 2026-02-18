// src/modules/payments/entitlements.service.cjs
'use strict';

/**
 * Public facade for entitlements.
 *
 * Goal:
 * - Other modules MUST NOT import payments/repos/* directly.
 * - Service provides a stable API and can fallback to SQL with injected db (tests).
 */

const EntitlementsRepo = require('./repos/entitlements.repo.cjs');

function mustUserId(userId) {
  if (!userId) {
    const err = new Error('ENTITLEMENTS_USER_REQUIRED');
    err.status = 400;
    err.code = 'ENTITLEMENTS_USER_REQUIRED';
    throw err;
  }
}

function mustArgs({ userId, templateSlug }) {
  mustUserId(userId);
  if (!templateSlug) {
    const err = new Error('ENTITLEMENTS_TEMPLATE_REQUIRED');
    err.status = 400;
    err.code = 'ENTITLEMENTS_TEMPLATE_REQUIRED';
    throw err;
  }
}

async function listUserEntitlementsSql({ db, userId }) {
  const sql = `
    SELECT template_slug, kind, order_id, created_at, starts_at, ends_at
      FROM public.entitlements
     WHERE user_id = $1
       AND (ends_at IS NULL OR ends_at > now())
     ORDER BY created_at DESC
  `;
  const r = await db.query(sql, [userId]);
  return r.rows || [];
}

async function hasValidEntitlementSql({ db, userId, templateSlug }) {
  const q = `
    SELECT 1
      FROM public.entitlements
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
 * Canonical list of active entitlements for user.
 * - Prefer injected db (tests / app.locals.db)
 * - Fallback to repo (prod path; repo may use pool internally)
 */
async function listUserEntitlements({ db, userId }) {
  mustUserId(userId);

  // 1) Prefer db if available (stable for tests)
  if (db && typeof db.query === 'function') {
    return await listUserEntitlementsSql({ db, userId });
  }

  // 2) Repo fallback
  if (EntitlementsRepo && typeof EntitlementsRepo.listUserEntitlements === 'function') {
    return await EntitlementsRepo.listUserEntitlements({ userId });
  }

  return [];
}

/**
 * Stable check: download allowed if BUY OR active RENT.
 * - Prefer injected db (tests)
 * - Fallback to repo
 */
async function hasValidEntitlement({ db, userId, templateSlug }) {
  mustArgs({ userId, templateSlug });

  if (db && typeof db.query === 'function') {
    return await hasValidEntitlementSql({ db, userId, templateSlug });
  }

  if (EntitlementsRepo && typeof EntitlementsRepo.findActiveEntitlement === 'function') {
    const row = await EntitlementsRepo.findActiveEntitlement({ userId, slug: templateSlug });
    return Boolean(row);
  }

  if (EntitlementsRepo && typeof EntitlementsRepo.hasEntitlement === 'function') {
    // keep compatibility if repo exposes only boolean check
    return await EntitlementsRepo.hasEntitlement({ userId, templateSlug });
  }

  return false;
}

module.exports = {
  listUserEntitlements,
  hasValidEntitlement,
};
