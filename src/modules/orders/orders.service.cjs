'use strict';

const OrdersRepo = require('./orders.repo.cjs');
const { PAYMENTS_PROVIDER } = require('../../config/payments.cjs');

function asInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function getUserIdFromReq(req) {
  // Prefer your real auth middleware: req.user.id
  if (req.user && req.user.id) return req.user.id;

  // Dev fallback: allow passing x-demo-user-id to test B12 quickly.
  const demo = req.headers['x-demo-user-id'];
  if (demo) {
    const n = asInt(demo);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const err = new Error('AUTH_REQUIRED');
  err.status = 401;
  throw err;
}

function resolveTemplateMeta(req, slug) {
  // If your app already prepared catalog data in app.locals, we can use it.
  // Expected: req.app.locals.templatesBySlug[slug] = { slug, priceCents, currency, zipReady, deal, license }
  const map = req.app && req.app.locals && req.app.locals.templatesBySlug;
  if (map && map[slug]) return map[slug];
  return null;
}

function normalizeDealType(dealType) {
  const v = String(dealType || '').toUpperCase();
  if (v !== 'BUY' && v !== 'RENT') {
    const err = new Error('INVALID_DEAL_TYPE');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeMoney({ amountCents, currency }) {
  const amount = asInt(amountCents);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('INVALID_AMOUNT');
    err.status = 400;
    throw err;
  }

  const cur = String(currency || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) {
    const err = new Error('INVALID_CURRENCY');
    err.status = 400;
    throw err;
  }

  return { amountCents: amount, currency: cur };
}

/**
 * Create an order for a template slug.
 * Money can be resolved from catalog meta (recommended), or from request body (fallback).
 */
async function createPendingOrder(req, { slug, dealType, amountCents, currency }) {
  const userId = getUserIdFromReq(req);
  const deal = normalizeDealType(dealType);

  const meta = resolveTemplateMeta(req, slug);

  // Prefer meta-defined pricing if present
  let money;
  if (meta && meta.priceCents) {
    money = normalizeMoney({ amountCents: meta.priceCents, currency: meta.currency || 'EUR' });
  } else {
    money = normalizeMoney({ amountCents, currency });
  }

  // Basic safety check: if catalog says ZIP is not ready — do not sell.
  if (meta && meta.zipReady === false) {
    const err = new Error('ZIP_NOT_READY');
    err.status = 409;
    throw err;
  }

  const order = await OrdersRepo.createOrder({
    userId,
    templateSlug: slug,
    dealType: deal,
    amountCents: money.amountCents,
    currency: money.currency,
    provider: PAYMENTS_PROVIDER,
  });

  return order;
}

module.exports = {
  getUserIdFromReq,
  createPendingOrder,
};
