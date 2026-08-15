// src/modules/payments/checkoutSuccessDev.controller.cjs
'use strict';

const paymentCompletion = require('./paymentCompletion.service.cjs');
const { renderStandalonePage } = require('../../web/helpers/renderStandalonePage.cjs');

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
 * - MUST reuse canonical payment completion pipeline.
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

    await client.query('COMMIT');

    // 2) canonical payment completion: mark paid + ensure entitlement.
    const completed = await paymentCompletion.completePaidOrder({
      orderId: order.id,
      providerSessionId: sessionId || order.provider_session_id || null,
      providerPaymentIntentId: order.provider_payment_intent_id || 'pi_dev',
    });
    const completedOrder = completed?.order || order;

    // 3) success page (rendered inside the normal site layout)
    const slug = encodeURIComponent(completedOrder.template_slug);
    const downloadUrl = `/downloads/${slug}`;

    return renderStandalonePage(req, res, {
      title: 'Payment successful — Tempasi',
      bodyHtml: `
        <h1>✅ Payment successful</h1>
        <p>Order #${escapeHtml(completedOrder.id)} — template <b>${escapeHtml(completedOrder.template_slug)}</b> activated.</p>
        <p><a class="c-btn c-btn--primary" href="${downloadUrl}">Download ZIP</a></p>
        <p style="opacity:.7;font-size:12px">session_id: ${escapeHtml(sessionId || completedOrder.provider_session_id || '')}</p>
      `,
    });
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
