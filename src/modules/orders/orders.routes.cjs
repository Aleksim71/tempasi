// src/modules/orders/orders.routes.cjs
/* eslint-env node */
'use strict';

const express = require('express');
const ordersService = require('./orders.service.cjs');

const router = express.Router();

function getUserId(req) {
  if (req && req.user && Number.isFinite(Number(req.user.id))) return Number(req.user.id);
  if (req && req.user && Number.isFinite(Number(req.user.user_id))) return Number(req.user.user_id);
  if (req && req.user && Number.isFinite(Number(req.user.userId))) return Number(req.user.userId);
  if (req && req.session && Number.isFinite(Number(req.session.userId))) return Number(req.session.userId);
  if (req && req.session && Number.isFinite(Number(req.session.user_id))) return Number(req.session.user_id);
  return null;
}

function wantsHtml(req) {
  const accept = String(req.headers?.accept || '');
  if (accept.includes('text/html')) return true;
  if (accept.includes('application/xhtml+xml')) return true;
  if (!accept) return true;
  if (accept.includes('application/json') || accept.includes('+json')) return false;
  return true;
}

function buyFailed(res, err, req) {
  const status = (err && err.status) || 500;
  const code = (err && err.code) || 'BUY_FAILED';
  const msg = err && err.message ? String(err.message) : 'BUY_FAILED';

  if (wantsHtml(req)) {
    const qs = new URLSearchParams();
    qs.set('buy_error', code);
    return res.redirect(303, `/templates?${qs.toString()}`);
  }

  return res.status(status).json({
    error: {
      code,
      message: msg,
    },
  });
}

router.post(
  '/:templateSlug/buy',
  express.urlencoded({ extended: false }),
  express.json(),
  async (req, res) => {
    const userId = getUserId(req);
    if (!userId) {
      if (wantsHtml(req)) return res.redirect(303, '/login');
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } });
    }

    const templateSlug = String(req.params.templateSlug || '').trim();
    if (!templateSlug) {
      return buyFailed(res, { status: 400, code: 'BAD_REQUEST', message: 'Missing templateSlug' }, req);
    }

    try {
      const result = await ordersService.createOrderCheckout(req, {
        userId,
        templateSlug,
        payload: req.body || {},
      });

      if (wantsHtml(req)) {
        return res.redirect(303, result.checkoutUrl);
      }

      return res.status(201).json({
        order_id: String(result.orderId),
        session_id: String(result.sessionId),
        checkout_url: result.checkoutUrl,
      });
    } catch (err) {
      return buyFailed(res, err, req);
    }
  }
);

module.exports = router;
module.exports.ordersRouter = router;
module.exports.router = router;
