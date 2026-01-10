'use strict';

const { pool } = require('../../config/db.cjs');

function toStr(v) {
  return v == null ? '' : String(v);
}

function toInt(v) {
  const n = Number(toStr(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function pickAuthUserId(req) {
  // Primary: cookie session middleware sets req.user
  const u = req.user;
  if (u && typeof u === 'object') {
    const id1 = toInt(u.id);
    if (Number.isFinite(id1) && id1 > 0) return id1;

    const id2 = toInt(u.userId);
    if (Number.isFinite(id2) && id2 > 0) return id2;
  }

  // Secondary: some apps attach req.userId
  const id3 = toInt(req.userId);
  if (Number.isFinite(id3) && id3 > 0) return id3;

  // Legacy fallback (B12): dev router used to attach req.devUserId
  const id4 = toInt(req.devUserId);
  if (Number.isFinite(id4) && id4 > 0) return id4;

  return NaN;
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

  const userId = pickAuthUserId(req);

  if (!Number.isFinite(userId) || userId <= 0) {
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
