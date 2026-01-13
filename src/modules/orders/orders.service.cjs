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
  const p = normalizeBuyPayload(payload);

  const order = await ordersRepo.createOrder({
    userId,
    templateSlug,
    dealType: p.dealType,
    amountCents: p.amountCents,
    currency: p.currency,
    provider: 'fake',
  });

  return order;
}

module.exports = {
  createPendingOrder,
};
