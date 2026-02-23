'use strict';

// Cabinet repo: isolated from shared helpers.
// Uses the already-working CJS DB config.
const db = require('../../../config/db.cjs');

function getPoolFromDb() {
  if (db && db.pool) return db.pool;
  if (typeof db.getPool === 'function') return db.getPool();
  if (db && typeof db.query === 'function') return db;
  throw new Error(
    'DB_POOL_NOT_AVAILABLE: expected src/config/db.cjs to export { pool } or getPool()'
  );
}

/**
 * Cabinet: "My Templates"
 *
 * entitlements:
 *  - user_id
 *  - template_slug
 *  - kind ('buy'|'rent')
 *  - deal_type (e.g. 'BUY')
 *  - starts_at
 *  - ends_at (nullable)
 *  - created_at
 *
 * templates:
 *  - slug, title, short_desc, demo_url, preview_image, status, updated_at
 */

async function listByUserWithTemplates(userId) {
  const pool = getPoolFromDb();

  const { rows } = await pool.query(
    `
    SELECT
      t.slug          AS template_slug,
      t.title         AS template_title,
      t.short_desc    AS template_short_desc,
      t.demo_url      AS template_demo_url,
      t.preview_image AS template_preview_image,
      t.status        AS template_status,
      t.updated_at    AS template_updated_at,

      e.kind       AS entitlement_kind,
      e.deal_type  AS entitlement_deal_type,
      e.starts_at  AS entitlement_starts_at,
      e.ends_at    AS entitlement_ends_at,
      e.created_at AS entitlement_granted_at,

      (e.ends_at IS NULL OR e.ends_at > NOW()) AS is_active
    FROM entitlements e
    JOIN templates t ON t.slug = e.template_slug
    WHERE e.user_id = $1
    ORDER BY e.created_at DESC
    `,
    [userId]
  );

  return rows;
}

async function countActiveByUser(userId) {
  const pool = getPoolFromDb();

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE ends_at IS NULL OR ends_at > NOW())::int AS active_entitlements
    FROM entitlements
    WHERE user_id = $1
    `,
    [userId]
  );

  return rows[0] || { active_entitlements: 0 };
}

module.exports = {
  listByUserWithTemplates,
  countActiveByUser,
};
