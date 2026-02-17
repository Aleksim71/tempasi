// src/modules/payments/repos/entitlements.repo.cjs
'use strict';

const { pool } = require('../../../config/db.cjs');

/**
 * Create entitlement for a paid order if it doesn't exist yet.
 * For BUY: ends_at = NULL
 * For RENT: for MVP we set 7 days (can be changed later)
 *
 * Hard idempotency:
 * - relies on UNIQUE index: entitlements(order_id) WHERE order_id IS NOT NULL
 * - uses INSERT ... ON CONFLICT ... DO NOTHING
 * - always returns inserted row OR existing row
 */
async function ensureEntitlementForOrder(order) {
  const kind = order.deal_type === 'RENT' ? 'rent' : 'buy';
  const endsAtSql = kind === 'rent' ? `now() + interval '7 days'` : 'NULL';

  // Insert (atomic). If already exists -> DO NOTHING.
  // The WHERE predicate matches our partial unique index.
  const insertSql = `
    INSERT INTO entitlements (user_id, template_slug, kind, order_id, starts_at, ends_at)
    VALUES ($1, $2, $3, $4, now(), ${endsAtSql})
    ON CONFLICT (order_id) WHERE order_id IS NOT NULL
    DO NOTHING
    RETURNING *
  `;
  const inserted = await pool.query(insertSql, [
    order.user_id,
    order.template_slug,
    kind,
    order.id,
  ]);

  if (inserted.rows[0]) return inserted.rows[0];

  // Return existing row (idempotent behavior)
  const selectSql = `
    SELECT *
      FROM entitlements
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 1
  `;
  const existing = await pool.query(selectSql, [order.id]);
  return existing.rows[0] || null;
}

/**
 * Find any active entitlement (buy OR rent not expired) for user+slug
 */
async function findActiveEntitlement({ userId, slug }) {
  const sql = `
    SELECT *
      FROM entitlements
     WHERE user_id = $1
       AND template_slug = $2
       AND (ends_at IS NULL OR ends_at > now())
     ORDER BY created_at DESC
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [userId, slug]);
  return rows[0] || null;
}

/**
 * Convenience helpers used by downloads/profile code.
 * kind: 'buy' | 'rent'
 */
async function hasEntitlement({ db, userId, templateSlug, kind }) {
  const q = `
    SELECT 1
      FROM entitlements
     WHERE user_id = $1
       AND template_slug = $2
       AND kind = $3
       AND (ends_at IS NULL OR ends_at > now())
     LIMIT 1
  `;
  const runner = db && typeof db.query === 'function' ? db : pool;
  const r = await runner.query(q, [userId, templateSlug, kind]);
  return r.rowCount > 0;
}

/**
 * List entitlements for user (buy + rent). Canonical shape:
 * [{ template_slug, kind, created_at, ends_at, order_id }]
 */
async function listUserEntitlements({ db, userId }) {
  const q = `
    SELECT template_slug, kind, created_at, ends_at, order_id
      FROM entitlements
     WHERE user_id = $1
     ORDER BY created_at DESC
  `;
  const runner = db && typeof db.query === 'function' ? db : pool;
  const r = await runner.query(q, [userId]);
  return r.rows || [];
}

module.exports = {
  ensureEntitlementForOrder,
  findActiveEntitlement,
  hasEntitlement,
  listUserEntitlements,
};
