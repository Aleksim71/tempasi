// src/modules/payments/repos/entitlements.repo.cjs
'use strict';

const { pool } = require('../../../config/db.cjs');

function upper(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().toUpperCase();
}

function defaultKindForDealType(dealType) {
  return upper(dealType) === 'RENT' ? 'rent' : 'buy';
}

async function getEntitlementByOrderId(client, orderId) {
  const r = await client.query(
    `
    SELECT *
      FROM public.entitlements
     WHERE order_id = $1
     LIMIT 1
    `,
    [orderId]
  );
  return r.rows[0] || null;
}

function isMissingConflictConstraintError(e) {
  const msg = e?.message ? String(e.message) : '';
  return msg.includes('no unique or exclusion constraint matching the ON CONFLICT specification');
}

/**
 * Idempotent: (same order_id) => same entitlement row.
 * Requires unique(order_id) for the fast path; has a fallback for older schemas.
 */
async function ensureEntitlementForOrder(order) {
  if (!order || !order.id) {
    const err = new Error('ENTITLEMENT_ORDER_REQUIRED');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    const kind = defaultKindForDealType(order.deal_type);
    const isRent = upper(order.deal_type) === 'RENT';
    const endsAtSql = isRent ? `now() + interval '7 days'` : 'NULL';

    // Fast path: return existing
    const existing = await getEntitlementByOrderId(client, order.id);
    if (existing) return existing;

    // Preferred insert path (needs UNIQUE on order_id)
    const insertSql = `
      INSERT INTO public.entitlements (user_id, template_slug, kind, order_id, starts_at, ends_at, created_at)
      VALUES ($1, $2, $3, $4, now(), ${endsAtSql}, now())
      ON CONFLICT (order_id) DO NOTHING
      RETURNING *
    `;

    try {
      const ins = await client.query(insertSql, [
        order.user_id,
        order.template_slug,
        kind,
        order.id,
      ]);
      if (ins.rows[0]) return ins.rows[0];
      return await getEntitlementByOrderId(client, order.id);
    } catch (e) {
      // Fallback when unique(order_id) doesn't exist in DB
      if (!isMissingConflictConstraintError(e)) throw e;

      // Retry idempotently without ON CONFLICT:
      // 1) check again
      const again = await getEntitlementByOrderId(client, order.id);
      if (again) return again;

      // 2) try insert; if duplicate race happens, ignore and select
      try {
        await client.query(
          `
          INSERT INTO public.entitlements (user_id, template_slug, kind, order_id, starts_at, ends_at, created_at)
          VALUES ($1, $2, $3, $4, now(), ${endsAtSql}, now())
          `,
          [order.user_id, order.template_slug, kind, order.id]
        );
      } catch (_e2) {
        // ignore and select below
      }

      return await getEntitlementByOrderId(client, order.id);
    }
  } finally {
    client.release();
  }
}

async function findActiveEntitlement({ userId, slug }) {
  const sql = `
    SELECT *
      FROM public.entitlements
     WHERE user_id = $1
       AND template_slug = $2
       AND (ends_at IS NULL OR ends_at > now())
     ORDER BY created_at DESC
     LIMIT 1
  `;
  const { rows } = await pool.query(sql, [userId, slug]);
  return rows[0] || null;
}

async function hasEntitlement({ userId, templateSlug }) {
  const row = await findActiveEntitlement({ userId, slug: templateSlug });
  return Boolean(row);
}

async function listUserEntitlements({ userId }) {
  const sql = `
    SELECT template_slug, kind, order_id, created_at, starts_at, ends_at
      FROM public.entitlements
     WHERE user_id = $1
       AND (ends_at IS NULL OR ends_at > now())
     ORDER BY created_at DESC
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows;
}

module.exports = {
  ensureEntitlementForOrder,
  findActiveEntitlement,
  hasEntitlement,
  listUserEntitlements,
};
