'use strict';

async function grantEntitlement({ db, userId, templateSlug, orderId }) {
  const q = `
    INSERT INTO entitlements (user_id, template_slug, order_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, template_slug)
    DO UPDATE SET order_id = COALESCE(entitlements.order_id, EXCLUDED.order_id)
    RETURNING id, user_id, template_slug, order_id, created_at
  `;
  const { rows } = await db.query(q, [userId, templateSlug, orderId ?? null]);
  return rows[0];
}

async function hasEntitlement({ db, userId, templateSlug }) {
  const q = `
    SELECT 1
    FROM entitlements
    WHERE user_id = $1 AND template_slug = $2
    LIMIT 1
  `;
  const { rows } = await db.query(q, [userId, templateSlug]);
  return rows.length > 0;
}

async function listUserEntitlements({ db, userId }) {
  const q = `
    SELECT template_slug, order_id, created_at
    FROM entitlements
    WHERE user_id = $1
    ORDER BY created_at DESC, template_slug ASC
  `;
  const { rows } = await db.query(q, [userId]);
  return rows;
}

module.exports = {
  grantEntitlement,
  hasEntitlement,
  listUserEntitlements,
};
