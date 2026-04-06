// src/modules/orders/orders.service.cjs
'use strict';

const ordersRepo = require('./orders.repo.cjs');
const paymentsService = require('../payments/payments.service.cjs');

const LICENSE_DEFAULTS = {
  PU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  CU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EL: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  ML: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EX: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
};

function normalizeBuyPayload(payload = {}) {
  const license = String(payload.license || 'PU').trim().toUpperCase();
  const fallback = LICENSE_DEFAULTS[license];
  if (!fallback) {
    const err = new Error('INVALID_LICENSE');
    err.status = 400;
    err.code = 'INVALID_LICENSE';
    throw err;
  }

  const amountCents =
    Number.isFinite(Number(payload.amountCents)) ? Number(payload.amountCents) :
    Number.isFinite(Number(payload.amount)) ? Math.round(Number(payload.amount) * 100) :
    fallback.amountCents;

  return {
    license,
    amountCents,
    currency: String(payload.currency || fallback.currency || 'EUR').trim().toUpperCase(),
    dealType: String(payload.dealType || fallback.dealType || 'BUY').trim().toUpperCase(),
  };
}

async function createPendingOrder({ userId, templateSlug, payload }) {
  if (!userId) {
    const err = new Error('USER_ID_REQUIRED');
    err.status = 400;
    err.code = 'USER_ID_REQUIRED';
    throw err;
  }

  if (!templateSlug) {
    const err = new Error('TEMPLATE_SLUG_REQUIRED');
    err.status = 400;
    err.code = 'TEMPLATE_SLUG_REQUIRED';
    throw err;
  }

  const p = normalizeBuyPayload(payload);

  if (p.dealType === 'BUY') {
    const alreadySold = await ordersRepo.hasPaidBuyByTemplateSlug(templateSlug);
    if (alreadySold) {
      const err = new Error('Template already sold (exclusive sale).');
      err.status = 409;
      err.code = 'TEMPLATE_ALREADY_SOLD';
      throw err;
    }
  }

  const order = await ordersRepo.createOrder({
    userId,
    templateSlug,
    dealType: p.dealType,
    license: p.license,
    amountCents: p.amountCents,
    currency: p.currency,
    provider: 'fake',
  });

  return order;
}

async function createOrderCheckout(req, { userId, templateSlug, payload }) {
  const order = await createPendingOrder({ userId, templateSlug, payload });

  const session = await paymentsService.createCheckoutSession(req, { order });
  if (!session || !session.id || !session.url) {
    const err = new Error('CHECKOUT_SESSION_CREATE_FAILED');
    err.status = 500;
    err.code = 'CHECKOUT_SESSION_CREATE_FAILED';
    throw err;
  }

  await ordersRepo.attachProviderSession({
    orderId: order.id,
    providerSessionId: session.id,
  });

  return {
    orderId: order.id,
    sessionId: session.id,
    checkoutUrl: session.url,
  };
}

module.exports = {
  normalizeBuyPayload,
  createPendingOrder,
  createOrderCheckout,
};
