'use strict';

const { pool } = require('../../../config/db.cjs');

/**
 * Create entitlement for a paid order if it doesn't exist yet.
 * For BUY: ends_at = NULL
 * For RENT: for MVP we set 7 days (can be changed later)
 */
async function ensureEntitlementForOrder(order) {
  const kind = order.deal_type === 'RENT' ? 'rent' : 'buy';

  const endsAt = (kind === 'rent')
    ? `now() + interval '7 days'`
    : 'NULL';

  // Insert if not exists (idempotent)
  const sql = `
    INSERT INTO entitlements (user_id, template_slug, kind, order_id, starts_at, ends_at)
    SELECT $1, $2, $3, $4, now(), ${endsAt}
    WHERE NOT EXISTS (
      SELECT 1
      FROM entitlements
      WHERE order_id = $4
    )
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [
    order.user_id,
    order.template_slug,
    kind,
    order.id,
  ]);
  return rows[0] || null;
}

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

module.exports = {
  ensureEntitlementForOrder,
  findActiveEntitlement,
};
