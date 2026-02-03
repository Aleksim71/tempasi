'use strict';

async function grantEntitlement({ db, userId, templateSlug, orderId = null, dealType = 'BUY' }) {
  const q = `
    INSERT INTO entitlements (user_id, template_slug, deal_type, order_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, template_slug)
    DO UPDATE SET
      order_id = COALESCE(EXCLUDED.order_id, entitlements.order_id)
    RETURNING id, user_id, template_slug, deal_type, order_id, created_at
  `;
  const { rows } = await db.query(q, [
    userId,
    templateSlug,
    String(dealType).toUpperCase(),
    orderId,
  ]);
  return rows[0];
}

async function hasEntitlement({ db, userId, templateSlug, dealType = 'BUY' }) {
  const q = `
    SELECT 1
    FROM entitlements
    WHERE user_id = $1 AND template_slug = $2 AND deal_type = $3
    LIMIT 1
  `;
  const { rows } = await db.query(q, [userId, templateSlug, String(dealType).toUpperCase()]);
  return rows.length > 0;
}

async function listUserEntitlements({ db, userId, dealType = 'BUY' }) {
  const q = `
    SELECT id, user_id, template_slug, deal_type, order_id, created_at
    FROM entitlements
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;
  const { rows } = await db.query(q, [userId]);
  return rows;
}

module.exports = {
  grantEntitlement,
  hasEntitlement,
  listUserEntitlements,
};
