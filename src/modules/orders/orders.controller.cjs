'use strict';

const { pool } = require('../../config/db.cjs');

function toStr(v) {
  return v == null ? '' : String(v);
}

function makeDevSessionId() {
  const rand = Math.random().toString(16).slice(2);
  return `dev_session_${Date.now()}_${rand}`;
}

async function buy(req, res) {
  const slug = toStr(req.params.slug).trim();
  if (!slug) {
    const err = new Error('TEMPLATE_SLUG_REQUIRED');
    err.status = 400;
    throw err;
  }

  // Временно: DEV auth через req.devUserId (прокидывает router)
  const userId = req.devUserId ?? null;

  if (!userId) {
    const err = new Error('AUTH_REQUIRED');
    err.status = 401;
    throw err;
  }

  const providerSessionId = makeDevSessionId();

  const r = await pool.query(
    `
    INSERT INTO public.orders
      (user_id, template_slug, deal_type, amount_cents, currency,
       status, provider, provider_session_id, created_at, updated_at)
    VALUES
      ($1, $2, 'BUY', 0, 'EUR',
       'pending', 'fake', $3, now(), now())
    RETURNING *
    `,
    [userId, slug, providerSessionId]
  );

  const order = r.rows[0];
  const checkoutUrl = `/checkout/success?order_id=${order.id}`;

  res.status(201).json({
    orderId: String(order.id),
    status: order.status,
    checkoutUrl,
    providerSessionId: order.provider_session_id,
  });
}

module.exports = { buy };
