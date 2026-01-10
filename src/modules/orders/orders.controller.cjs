'use strict';

const OrdersService = require('./orders.service.cjs');
const OrdersRepo = require('./orders.repo.cjs');

// ВАЖНО: payments модуль может экспортировать
// 1) объект { createCheckoutSession }
// 2) или саму функцию createCheckoutSession (module.exports = function ...)
// Поэтому ниже — адаптер.
const Payments = require('../payments/payments.service.cjs');

function resolveCreateCheckoutSession(PaymentsModule) {
  if (PaymentsModule && typeof PaymentsModule.createCheckoutSession === 'function') {
    return PaymentsModule.createCheckoutSession.bind(PaymentsModule);
  }
  if (typeof PaymentsModule === 'function') {
    return PaymentsModule; // module.exports = function createCheckoutSession(...)
  }
  throw new TypeError('Payments.createCheckoutSession is not a function');
}

/**
 * POST /api/orders/:slug/buy
 * body: { amountCents, currency }
 * headers (dev): x-demo-user-id: 1
 */
async function buyTemplate(req, res) {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    const err = new Error('SLUG_REQUIRED');
    err.status = 400;
    throw err;
  }

  const amountCents = req.body?.amountCents;
  const currency = req.body?.currency;

  // 1) создаём pending order в БД
  const order = await OrdersService.createPendingOrder(req, {
    slug,
    dealType: 'BUY',
    amountCents,
    currency,
  });

  // 2) создаём checkout session у провайдера
  const createCheckoutSession = resolveCreateCheckoutSession(Payments);
  const session = await createCheckoutSession(req, { order });

  // 3) если репозиторий умеет — сохраним provider_session_id + url
  // (не ломаемся, если в репо другое имя метода)
  if (session && (session.id || session.url)) {
    const sessionId = session.id || null;
    const checkoutUrl = session.url || null;

    if (typeof OrdersRepo.setProviderSession === 'function') {
      await OrdersRepo.setProviderSession({ orderId: order.id, sessionId, checkoutUrl });
    } else if (typeof OrdersRepo.updateProviderSession === 'function') {
      await OrdersRepo.updateProviderSession({ orderId: order.id, sessionId, checkoutUrl });
    } else if (typeof OrdersRepo.updateOrder === 'function') {
      // fallback (если вдруг есть универсальный апдейтер)
      await OrdersRepo.updateOrder({
        id: order.id,
        providerSessionId: sessionId,
        providerCheckoutUrl: checkoutUrl,
      });
    }
  }

  // 4) ответ
  res.status(201).json({
    ok: true,
    orderId: order.id,
    checkoutUrl: session?.url,
    providerSessionId: session?.id,
  });
}

module.exports = {
  buyTemplate,
};
