// src/modules/payments/checkoutSuccessDev.controller.cjs
'use strict';

const OrdersRepo = require('../orders/orders.repo.cjs');
const EntitlementsRepo = require('./repos/entitlements.repo.cjs');

function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function escapeHtml(s) {
  return toStr(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Dev-only success handler.
 *
 * Stage 0.5 rule:
 * - MUST NOT directly INSERT entitlements here.
 * - MUST reuse canonical pipeline: markOrderPaid -> ensureEntitlementForOrder
 *
 * Accepts:
 * - ?order_id=123 (preferred)
 * - ?session_id=... (fallback)
 */
async function handleCheckoutSuccessDev(req, res) {
  const sessionId = toStr(req.query.session_id).trim();
  const orderIdRaw = toStr(req.query.order_id).trim();
  const orderId = orderIdRaw ? Number(orderIdRaw) : NaN;

  if (!sessionId && !Number.isFinite(orderId)) {
    const err = new Error('CHECKOUT_SUCCESS_MISSING_PARAMS');
    err.status = 400;
    throw err;
  }

  // We intentionally use db pool through repositories to match webhook behavior.
  const { pool } = require('../../config/db.cjs');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) find order (by id preferred, else by provider_session_id)
    let order = null;

    if (Number.isFinite(orderId)) {
      const r = await client.query(`SELECT * FROM public.orders WHERE id = $1 LIMIT 1`, [orderId]);
      order = r.rows[0] || null;
    } else if (sessionId) {
      const r = await client.query(
        `SELECT * FROM public.orders WHERE provider_session_id = $1 LIMIT 1`,
        [sessionId]
      );
      order = r.rows[0] || null;
    }

    if (!order) {
      const err = new Error('ORDER_NOT_FOUND');
      err.status = 404;
      throw err;
    }

    // 2) mark order paid (idempotent) using the same repo method as webhook
    // IMPORTANT: OrdersRepo currently uses its own db/pool internally.
    // We still wrap in a transaction here for the "find order" read, but the repo
    // update is idempotent, and entitlement creation is also idempotent.
    const paid = await OrdersRepo.markOrderPaid({
      orderId: order.id,
      providerPaymentIntentId: order.provider_payment_intent_id || 'pi_dev',
    });

    // If markOrderPaid returns something truthy, ensure entitlement
    if (paid) {
      await EntitlementsRepo.ensureEntitlementForOrder(paid);
    }

    await client.query('COMMIT');

    // 3) success HTML + CTA
    const slug = encodeURIComponent(order.template_slug);
    const downloadUrl = `/download/${slug}`;

    return res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Оплата успешна — Tempasi</title>
  <link rel="stylesheet" href="/css/core.css"/>
  <link rel="stylesheet" href="/css/custom.css"/>
</head>
<body>
  <main class="page">
    <h1>✅ Оплата успешна</h1>
    <p>Заказ #${escapeHtml(order.id)} — шаблон <b>${escapeHtml(order.template_slug)}</b> активирован.</p>
    <p><a class="btn primary" href="${downloadUrl}">Скачать ZIP</a></p>
    <p style="opacity:.7;font-size:12px">session_id: ${escapeHtml(sessionId || order.provider_session_id || '')}</p>
  </main>
</body>
</html>`);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { handleCheckoutSuccessDev };
