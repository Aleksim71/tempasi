'use strict';

const { pool } = require('../../config/db.cjs');

async function createOrder({
  userId,
  templateSlug,
  dealType,
  amountCents,
  currency,
  provider,
}) {
  const sql = `
    INSERT INTO orders (user_id, template_slug, deal_type, amount_cents, currency, provider, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [
    userId,
    templateSlug,
    dealType,
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

async function markOrderPaid({ orderId, providerPaymentIntentId = null }) {
  const sql = `
    UPDATE orders
    SET status = 'paid',
        provider_payment_intent_id = COALESCE($2, provider_payment_intent_id),
        updated_at = now()
    WHERE id = $1 AND status <> 'paid'
    RETURNING *
  `;
  const { rows } = await pool.query(sql, [orderId, providerPaymentIntentId]);
  return rows[0] || null;
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
  markOrderPaid,
  markOrderFailed,
};
