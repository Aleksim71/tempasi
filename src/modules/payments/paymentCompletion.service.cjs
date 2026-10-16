// src/modules/payments/paymentCompletion.service.cjs
'use strict';

const OrdersRepo = require('../orders/orders.repo.cjs');
const EntitlementsRepo = require('./repos/entitlements.repo.cjs');
const AccountCreditsService = require('./accountCredits.service.cjs');
const CheckoutCreditsService = require('./checkoutCredits.service.cjs');
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

// TEMPASI_CANONICAL_ORDER_CASE_ASSIGNMENT (2026-08-16)
// order.case_ids (jsonb, populated at order-creation time for RENT —
// see orders.service.cjs createPendingOrder) previously never turned
// into public.order_case_assignments rows anywhere in this canonical
// completion path. Only two non-canonical shortcuts did that insert:
// cart.checkout-pass.service.js (at checkout-SESSION-creation time,
// i.e. before payment) and cart.routes.js's demoCompleteCartCheckout
// (its own from-scratch reimplementation). Neither is the code every
// RENT completion — including a real future payment-provider webhook —
// is meant to funnel through. Adding it here, once, at the single
// canonical "this order is now paid" point, fixes every current and
// future entry point at once instead of adding a fourth copy of the
// same insert.
function normalizeCaseIdsFromOrder(input) {
  if (!input) return [];
  const raw = Array.isArray(input)
    ? input
    : (() => {
        if (typeof input === 'string') {
          try {
            return JSON.parse(input);
          } catch (_) {
            return input.split(',');
          }
        }
        return [];
      })();

  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => String(id || '').trim()).filter(Boolean))];
}

async function assignPaidRentOrderToCases(paidOrder) {
  if (String(paidOrder.deal_type || '').toUpperCase() !== 'RENT') return [];

  const caseIds = normalizeCaseIdsFromOrder(paidOrder.case_ids);
  if (caseIds.length === 0) return [];

  const assigned = [];
  for (const caseId of caseIds) {
    try {
      await query(
        `
          INSERT INTO public.order_case_assignments(order_id, case_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [paidOrder.id, caseId],
      );
      assigned.push(caseId);
    } catch (e) {
      // TEMPASI_ORDER_CASE_ASSIGNMENTS_TABLE_MISSING (2026-08-16):
      // some minimal test/dev DBs (see tests/helpers) don't create
      // this table at all. Don't let that crash payment completion —
      // undefined_table (42P01) is the one error we deliberately
      // swallow here; anything else (constraint violation, connection
      // failure, etc.) is a real problem and must still surface.
      if (e && e.code === '42P01') continue;
      throw e;
    }
  }

  return assigned;
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

  const appliedCredits = await CheckoutCreditsService.applyReservedCreditForOrder(db, paidOrder.id);

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

  const createdCredits = await AccountCreditsService.createCreditsFromConvertedRents({
    userId: paidOrder.user_id,
    convertedRentEntitlements: closedRentEntitlements,
    buyOrderId: paidOrder.id,
  });

  const entitlement = await EntitlementsRepo.ensureEntitlementForOrder(paidOrder);

  const assignedCaseIds = await assignPaidRentOrderToCases(paidOrder);

  return {
    order: paidOrder,
    entitlement,
    closedRentEntitlements,
    createdCredits,
    appliedCredits,
    assignedCaseIds,
  };
}

module.exports = {
  completePaidOrder,
  findOrder,
};

// === TEMPASI_STEP_5C_PAYMENT_COMPLETION_NOTE ===
// Step 5C integration note:
// After external provider payment succeeds and before/around entitlement creation,
// call checkoutCredits.applyReservedCreditForOrder(dbOrClient, order.id).
// If checkout/session fails or expires, call checkoutCredits.releaseReservedCreditForOrder(dbOrClient, order.id).
// Do not mutate provider payment amount after session creation.
// === /TEMPASI_STEP_5C_PAYMENT_COMPLETION_NOTE ===
