// src/modules/orders/orders.routes.cjs
/* eslint-env node */
'use strict';

const express = require('express');
const ordersService = require('./orders.service.cjs');

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
  return typeof x === 'string' && ['PU', 'CU', 'EL', 'ML', 'EX'].includes(x);
}

function buyFailed(res, err) {
  const status = (err && err.status) || 500;
  const code = (err && err.code) || 'BUY_FAILED';
  const msg = err && err.message ? String(err.message) : 'BUY_FAILED';

  return res.status(status).json({
    error: {
      code,
      message: msg,
    },
  });
}

/**
 * POST /api/orders/:templateSlug/buy
 * Body: { license: 'PU' }
 *
 * IMPORTANT:
 * - We MUST parse JSON here (app.js does not have global express.json()).
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

  try {
    const order = await ordersService.createPendingOrder({
      userId,
      templateSlug,
      payload: { license },
    });

    const orderId = order && (order.id || order.order_id);
    if (!orderId) throw new Error('Order insert failed (no id)');

    return res.status(201).json({ order_id: String(orderId) });
  } catch (err) {
    return buyFailed(res, err);
  }
});

module.exports = router;
// Export named alias for pickRouter()
module.exports.ordersRouter = router;
module.exports.router = router;
