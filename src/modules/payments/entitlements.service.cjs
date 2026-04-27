'use strict';

const { getPool } = require('../../../scripts/db.pool.cjs');

/**
 * Canonical entitlements service (used by downloads/profile).
 *
 * IMPORTANT:
 * - This service must NOT depend on catalog tables like `templates`.
 *   Tests and core access control should work even if templates catalog is not migrated
 *   in DATABASE_URL_TEST.
 *
 * Schema used here:
 *   entitlements: user_id, template_slug, kind, order_id, starts_at, ends_at, created_at, deal_type
 */

function normalizeUserId(userIdOrUser) {
  if (userIdOrUser == null) {
    throw new Error('ENTITLEMENTS_INVALID_USER_ID: got null/undefined');
  }

  if (typeof userIdOrUser === 'number' || typeof userIdOrUser === 'string') {
    return userIdOrUser;
  }

  if (typeof userIdOrUser === 'object') {
    if (userIdOrUser.id != null) return userIdOrUser.id;
    if (userIdOrUser.user_id != null) return userIdOrUser.user_id;
    if (userIdOrUser.userId != null) return userIdOrUser.userId;

    throw new Error(
      'ENTITLEMENTS_INVALID_USER_ID: expected number/string or object with {id|user_id|userId}'
    );
  }

  throw new Error(
    `ENTITLEMENTS_INVALID_USER_ID: unsupported type ${typeof userIdOrUser}`
  );
}

/**
 * Kept name for backwards-compatibility.
 * Returns entitlement rows (no JOIN templates).
 */
async function listUserEntitlementsWithTemplates(userIdOrUser) {
  const userId = normalizeUserId(userIdOrUser);
  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT
      template_slug,
      kind,
      deal_type,
      order_id,
      created_at,
      starts_at,
      ends_at,
      (ends_at IS NULL OR ends_at > NOW()) AS is_active
    FROM entitlements
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [userId]
  );

  return rows;
}

/**
 * Backward-compatible API expected by profile layer:
 * profile.controller.cjs calls EntitlementsService.listUserEntitlements(...)
 *
 * Expected minimal shape:
 *   { template_slug, deal_type, created_at }
 */
async function listUserEntitlements(userIdOrUser) {
  const rows = await listUserEntitlementsWithTemplates(userIdOrUser);

  return rows.map((r) => ({
    ...r,
    template_slug: r.template_slug,
    deal_type: r.deal_type,
    created_at: r.created_at,
  }));
}

/**
 * BUY-only access control helper for ZIP downloads.
 *
 * RENT is a reservation/hold and MUST NOT grant ZIP download access.
 */
async function hasDownloadEntitlement({ db, userId, templateSlug } = {}) {
  if (!db || typeof db.query !== 'function') {
    db = getPool();
  }

  const normalizedUserId = normalizeUserId(userId);

  const { rows } = await db.query(
    `
    SELECT
      EXISTS(
        SELECT 1
        FROM entitlements
        WHERE user_id = $1
          AND template_slug = $2
          AND (ends_at IS NULL OR ends_at > NOW())
          AND LOWER(COALESCE(kind, '')) <> 'rent'
          AND UPPER(COALESCE(NULLIF(deal_type, ''), 'BUY')) = 'BUY'
      ) AS ok
    `,
    [normalizedUserId, templateSlug]
  );

  return Boolean(rows[0] && rows[0].ok);
}

/**
 * Backward-compatible alias used by downloads.service.
 * Despite the old name, this is intentionally BUY-only for downloads.
 */
async function hasValidEntitlement({ db, userId, templateSlug } = {}) {
  return hasDownloadEntitlement({ db, userId, templateSlug });
}

/**
 * Access control helper for downloads.
 */
async function hasActiveEntitlement(userIdOrUser, templateSlug) {
  const userId = normalizeUserId(userIdOrUser);
  const pool = getPool();

  const { rows } = await pool.query(
    `
    SELECT
      EXISTS(
        SELECT 1
        FROM entitlements
        WHERE user_id = $1
          AND template_slug = $2
          AND (ends_at IS NULL OR ends_at > NOW())
      ) AS ok
    `,
    [userId, templateSlug]
  );

  return Boolean(rows[0] && rows[0].ok);
}

module.exports = {
  listUserEntitlementsWithTemplates,
  listUserEntitlements,
  hasActiveEntitlement,
  hasDownloadEntitlement,
  hasValidEntitlement,
};
