// src/modules/orders/orders.routes.cjs
/* eslint-env node */
'use strict';

const express = require('express');
const { pool } = require('../../config/db.cjs');

const router = express.Router();

/**
 * Resolve userId from the auth layer.
 * We support a few common shapes to be resilient in tests/dev-login:
 * - req.user.id
 * - req.session.userId
 * - req.session.user_id
 */
function getUserId(req) {
  if (req && req.user && Number.isFinite(Number(req.user.id))) return Number(req.user.id);
  if (req && req.session && Number.isFinite(Number(req.session.userId))) return Number(req.session.userId);
  if (req && req.session && Number.isFinite(Number(req.session.user_id))) return Number(req.session.user_id);
  return null;
}

function isValidLicense(x) {
  // keep strict but small; extend later if you add more
  return typeof x === 'string' && ['PU', 'CU', 'EL', 'ML', 'EX'].includes(x);
}

function buyFailed(res, err) {
  return res.status(500).json({
    error: {
      code: 'BUY_FAILED',
      message: err && err.message ? String(err.message) : 'BUY_FAILED',
    },
  });
}

/**
 * POST /api/orders/:templateSlug/buy
 * Body: { license: 'PU' }
 *
 * IMPORTANT:
 * - We MUST parse JSON here (app.js does not have global express.json()).
 * - Otherwise req.body is empty and license becomes NULL -> NOT NULL violation.
 *
 * NOTE (Stage 0.5):
 * This route MUST NOT grant entitlements directly.
 * Money pipeline should be:
 * order (pending) -> checkout -> webhook -> mark paid -> ensure entitlement -> download.
 */
router.post('/:templateSlug/buy', express.json(), async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });

  const templateSlug = String(req.params.templateSlug || '').trim();
  if (!templateSlug) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing templateSlug' } });

  const license = req && req.body ? req.body.license : undefined;
  if (!isValidLicense(license)) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Invalid license. Expected one of: PU, CU, EL, ML, EX' },
    });
  }

  // Minimal pricing stub for now (tests only need 201 + order_id).
  // Keep schema-safe: we set all columns that were failing earlier (deal_type, amount_cents, currency, license).
  const dealType = 'BUY';
  const amountCents = 0;
  const currency = 'EUR';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const qOrder = `
      INSERT INTO orders (user_id, template_slug, deal_type, license, amount_cents, currency)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    const pOrder = [userId, templateSlug, dealType, license, amountCents, currency];
    const orderRes = await client.query(qOrder, pOrder);

    const orderId = orderRes.rows[0] && orderRes.rows[0].id;
    if (!orderId) throw new Error('Order insert failed (no id)');

    await client.query('COMMIT');

    return res.status(201).json({ order_id: orderId });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_e) {
      // ignore
    }
    return buyFailed(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
// Export named alias for pickRouter()
module.exports.ordersRouter = router;
module.exports.router = router;
