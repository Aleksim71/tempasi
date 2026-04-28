// src/modules/payments/paymentCompletion.service.cjs
'use strict';

const OrdersRepo = require('../orders/orders.repo.cjs');
const EntitlementsRepo = require('./repos/entitlements.repo.cjs');
const db = require('../../config/db.cjs');

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

async function query(sql, params = []) {
  if (db && typeof db.query === 'function') {
    return db.query(sql, params);
  }

  if (db && db.pool && typeof db.pool.query === 'function') {
    return db.pool.query(sql, params);
  }

  if (db && db.default && typeof db.default.query === 'function') {
    return db.default.query(sql, params);
  }

  throw new Error('DB_QUERY_NOT_AVAILABLE');
}

async function findOrder({ orderId, providerSessionId }) {
  if (orderId) {
    const result = await query(
      `SELECT * FROM public.orders WHERE id = $1 LIMIT 1`,
      [orderId],
    );

    if (result.rows[0]) return result.rows[0];
  }

  if (providerSessionId) {
    const result = await query(
      `SELECT * FROM public.orders WHERE provider_session_id = $1 LIMIT 1`,
      [providerSessionId],
    );

    if (result.rows[0]) return result.rows[0];
  }

  const err = new Error('ORDER_NOT_FOUND');
  err.status = 404;
  throw err;
}

async function markOrderPaid(order, {
  providerPaymentIntentId = null,
  providerSessionId = null,
} = {}) {
  if (OrdersRepo && typeof OrdersRepo.markOrderPaid === 'function') {
    const paidOrder = await OrdersRepo.markOrderPaid(order.id, {
      providerPaymentIntentId,
      provider_payment_intent_id: providerPaymentIntentId,
      providerSessionId,
      provider_session_id: providerSessionId,
    });

    if (paidOrder) return paidOrder;
  }

  const result = await query(
    `
    UPDATE public.orders
       SET status = 'paid',
           provider_payment_intent_id = COALESCE($2, provider_payment_intent_id),
           provider_session_id = COALESCE($3, provider_session_id)
     WHERE id = $1
     RETURNING *
    `,
    [order.id, providerPaymentIntentId, providerSessionId],
  );

  return result.rows[0] || null;
}

async function completePaidOrder(input = {}) {
  const orderId = firstDefined(input.orderId, input.order_id, input.id);
  const providerSessionId = firstDefined(
    input.providerSessionId,
    input.provider_session_id,
    input.sessionId,
    input.session_id,
  );
  const providerPaymentIntentId = firstDefined(
    input.providerPaymentIntentId,
    input.provider_payment_intent_id,
    input.paymentIntentId,
    input.payment_intent_id,
  );

  const order = await findOrder({ orderId, providerSessionId });

  let paidOrder = order;
  if (String(order.status || '').toLowerCase() !== 'paid') {
    paidOrder = await markOrderPaid(order, {
      providerPaymentIntentId,
      providerSessionId,
    });
  }

  if (!paidOrder) {
    paidOrder = await findOrder({ orderId: order.id, providerSessionId });
  }

  let closedRentEntitlements = [];
  if (
    String(paidOrder.deal_type || '').toUpperCase() === 'BUY' &&
    EntitlementsRepo &&
    typeof EntitlementsRepo.closeActiveRentForBuyerBuy === 'function'
  ) {
    closedRentEntitlements = await EntitlementsRepo.closeActiveRentForBuyerBuy({
      userId: paidOrder.user_id,
      templateSlug: paidOrder.template_slug,
      buyOrderId: paidOrder.id,
    });
  }

  const entitlement = await EntitlementsRepo.ensureEntitlementForOrder(paidOrder);

  return {
    order: paidOrder,
    entitlement,
    closedRentEntitlements,
  };
}

module.exports = {
  completePaidOrder,
  findOrder,
};
