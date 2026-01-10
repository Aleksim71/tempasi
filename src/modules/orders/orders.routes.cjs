'use strict';

const express = require('express');
const router = express.Router();

const OrdersController = require('./orders.controller.cjs');

function isLoopbackIp(ip) {
  const s = String(ip || '').trim();
  return (
    s === '127.0.0.1' ||
    s === '::1' ||
    s.startsWith('::ffff:127.0.0.1') ||
    s.startsWith('::ffff:7f00:1')
  );
}

function isLocalRequest(req) {
  // express может дать req.ip, а реальный адрес — в сокете
  const ip1 = req.ip;
  const ip2 = req.socket && req.socket.remoteAddress;
  return isLoopbackIp(ip1) || isLoopbackIp(ip2);
}

/**
 * DEV helper: resolve user_id
 * Правило:
 * - если запрос локальный (loopback) И есть заголовок x-dev-user-id (или x-demo-user-id) → используем
 * - иначе (и в проде тоже) → не даём дев-обход
 */
function resolveDevUserId(req) {
  if (!isLocalRequest(req)) return null;

  const h =
    req.headers['x-dev-user-id'] ??
    req.headers['x-demo-user-id'] ??
    req.headers['x-dev-user'] ??
    null;

  if (h == null || String(h).trim() === '') return null;

  const v = Number(h);
  return Number.isFinite(v) ? v : null;
}

// POST /api/orders/:slug/buy
router.post('/:slug/buy', express.json(), async (req, res, next) => {
  try {
    const devUserId = resolveDevUserId(req);
    if (devUserId) {
      Object.defineProperty(req, 'devUserId', {
        value: devUserId,
        enumerable: false,
        configurable: true,
      });
    }

    await OrdersController.buy(req, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
