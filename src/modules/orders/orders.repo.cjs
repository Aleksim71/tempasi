// src/modules/orders/orders.repo.cjs
'use strict';

const { pool } = require('../../config/db.cjs');

async function createOrder({
  userId,
  templateSlug,
  dealType,
  license,
  amountCents,
  currency,
  provider,
}) {
  if (!license) {
    const err = new Error('LICENSE_REQUIRED');
    err.status = 400;
    err.code = 'LICENSE_REQUIRED';
    throw err;
  }

  const sql = `
    INSERT INTO orders (user_id, template_slug, deal_type, license, amount_cents, currency, provider, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [
    userId,
    templateSlug,
    dealType,
    license,
    amountCents,
    currency,
    provider,
  ]);
  return rows[0];
}

async function attachProviderSession({ orderId, providerSessionId }) {
  const sql = `
    UPDATE orders
    SET provider_session_id = $2,
        updated_at = now()
    WHERE id = $1
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [orderId, providerSessionId]);
  return rows[0];
}

async function findOrderByProviderSessionId(providerSessionId) {
  const sql = `SELECT * FROM orders WHERE provider_session_id = $1 LIMIT 1`;
  const { rows } = await pool.query(sql, [providerSessionId]);
  return rows[0] || null;
}

async function hasPaidBuyByTemplateSlug(templateSlug) {
  const sql = `
    SELECT 1
    FROM orders
    WHERE template_slug = $1
      AND deal_type = 'BUY'
      AND status = 'paid'
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [templateSlug]);
  return Boolean(rows && rows[0]);
}

async function findActiveRentReservationByTemplateSlug(templateSlug) {
  const sql = `
    SELECT
      e.id,
      e.user_id,
      e.template_slug,
      e.kind,
      e.deal_type,
      e.order_id,
      e.starts_at,
      e.ends_at
    FROM public.entitlements e
    WHERE e.template_slug = $1
      AND (e.ends_at IS NULL OR e.ends_at > now())
      AND (
        LOWER(COALESCE(e.kind, '')) = 'rent'
        OR UPPER(COALESCE(e.deal_type, '')) = 'RENT'
      )
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [templateSlug]);
  return rows[0] || null;
}

async function markOrderPaid({ orderId, providerPaymentIntentId = null }) {
  const sql = `
    UPDATE orders
    SET status = 'paid',
        provider_payment_intent_id = COALESCE($2, provider_payment_intent_id),
        updated_at = now()
    WHERE id = $1 AND status <> 'paid'
    RETURNING *
  `;
  try {
    const { rows } = await pool.query(sql, [orderId, providerPaymentIntentId]);
    return rows[0] || null;
  } catch (e) {
    const isUniqueViolation = e && e.code === '23505';
    const constraint = e && (e.constraint || e.detail || '');
    if (isUniqueViolation && String(constraint).includes('orders_unique_paid_buy_per_template')) {
      const err = new Error('Template already sold (exclusive sale).');
      err.status = 409;
      err.code = 'TEMPLATE_ALREADY_SOLD';
      throw err;
    }
    throw e;
  }
}

async function markOrderFailed({ orderId }) {
  const sql = `
    UPDATE orders
    SET status = 'failed',
        updated_at = now()
    WHERE id = $1 AND status = 'pending'
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [orderId]);
  return rows[0] || null;
}

module.exports = {
  createOrder,
  attachProviderSession,
  findOrderByProviderSessionId,
  hasPaidBuyByTemplateSlug,
  findActiveRentReservationByTemplateSlug,
  markOrderPaid,
  markOrderFailed,
};
