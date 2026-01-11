'use strict';

/**
 * Orders Service
 * - creates pending order
 * - normalizes input (dealType, amount, currency)
 * - always provides amountCents for DB (orders.amount_cents NOT NULL)
 * - best-effort checkout session (only if req provided)
 */

const { getPool } = require('../../../scripts/db.pool.cjs');

const ordersRepo = require('./orders.repo.cjs');
const paymentsService = require('../payments/payments.service.cjs');

/* ============================================================
 * Helpers
 * ============================================================ */

function getUserIdFromReq(req) {
  // support both styles:
  // - req.user (attachUser)
  // - res.locals.user (some middlewares attach to locals)
  const user =
    req?.user ||
    req?.session?.user ||
    req?.res?.locals?.user ||
    req?.res?.locals?.session?.user ||
    null;

  const id = user && user.id != null ? Number(user.id) : NaN;
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('AUTH_REQUIRED');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }
  return id;
}

function normalizeDealType(v) {
  const x = String(v || '').toUpperCase();
  if (x === 'BUY' || x === 'RENT' || x === 'FREE') return x;
  throw new Error('INVALID_DEAL_TYPE');
}

/**
 * Accepts either:
 * - "9" (meaning 9 EUR)
 * - "9.99" (meaning 9.99 EUR)
 * Returns:
 * - amount (number, EUR)
 * - amountCents (int, EUR cents)
 */
function normalizeMoney(amount, currency) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) throw new Error('INVALID_AMOUNT');

  const cur = String(currency || '').toUpperCase();
  if (!cur) throw new Error('INVALID_CURRENCY');

  // cents as integer, rounded (safe for inputs like 9.99)
  const amountCents = Math.round(a * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) throw new Error('INVALID_AMOUNT');

  return { amount: a, amountCents, currency: cur };
}

/* ============================================================
 * Main API
 * ============================================================ */

async function createPendingOrder(params) {
  const { req, userId: userIdMaybe, slug, dealType, amount, currency } = params || {};

  const userId =
    Number.isFinite(Number(userIdMaybe)) && Number(userIdMaybe) > 0
      ? Number(userIdMaybe)
      : getUserIdFromReq(req);

  const templateSlug = String(slug || '').trim();
  if (!templateSlug) {
    const err = new Error('TEMPLATE_SLUG_REQUIRED');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const deal = normalizeDealType(dealType);
  const money = normalizeMoney(amount, currency);

  const pool = getPool();

  // 1) create order in DB
  // IMPORTANT: DB requires amount_cents NOT NULL
  const order = await ordersRepo.createOrder({
    pool,
    userId,
    templateSlug,
    dealType: deal,
    amount: money.amount, // optional (if repo ignores it, ok)
    amountCents: money.amountCents,
    currency: money.currency,
    status: 'pending',
    provider: 'dev', // not-null in DB
  });

  // 2) best-effort checkout session
  let checkout = null;
  if (req) {
    try {
      checkout = await paymentsService.createCheckoutSession({
        order,
        req,
      });
    } catch (e) {
      checkout = null; // dev: ignore provider errors
    }
  }

  return {
    orderId: String(order.id),
    status: order.status,
    checkoutUrl: checkout?.checkoutUrl || `/checkout/success?order_id=${order.id}`,
    providerSessionId: checkout?.providerSessionId || null,
  };
}

module.exports = {
  getUserIdFromReq,
  createPendingOrder,
};
