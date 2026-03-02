// src/modules/orders/orders.service.cjs
'use strict';

const ordersRepo = require('./orders.repo.cjs');

// простая таблица цен под тесты/дев
const LICENSE_TO_PRICE = {
  PU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  CU: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EL: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  ML: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
  EX: { amountCents: 0, currency: 'EUR', dealType: 'BUY' },
};

function normalizeBuyPayload(payload = {}) {
  // тест шлёт { license: 'PU' }
  if (payload.license && LICENSE_TO_PRICE[payload.license]) {
    const p = LICENSE_TO_PRICE[payload.license];
    return { ...p, license: payload.license };
  }

  // если вдруг шлёшь уже “полный” формат
  return {
    dealType: String(payload.dealType || 'BUY').toUpperCase(),
    amountCents: Number.isFinite(payload.amountCents) ? payload.amountCents : 0,
    currency: String(payload.currency || 'EUR').toUpperCase(),
    license: payload.license ? String(payload.license) : null,
  };
}

async function createPendingOrder({ userId, templateSlug, payload }) {
  if (!userId) {
    const err = new Error('UNAUTHORIZED');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  if (!templateSlug) {
    const err = new Error('BAD_REQUEST');
    err.status = 400;
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const p = normalizeBuyPayload(payload);

  if (String(p.dealType).toUpperCase() === 'BUY') {
    const alreadySold = await ordersRepo.hasPaidBuyByTemplateSlug(templateSlug);
    if (alreadySold) {
      const err = new Error('Template already sold (exclusive sale).');
      err.status = 409;
      err.code = 'TEMPLATE_ALREADY_SOLD';
      throw err;
    }
  }

  // IMPORTANT: repo should accept license; if it doesn't, we'll adjust repo next.
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

module.exports = {
  createPendingOrder,
};
