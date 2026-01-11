'use strict';

const crypto = require('crypto');

const OrdersRepo = require('../orders/orders.repo.cjs');
const EntitlementsRepo = require('./repos/entitlements.repo.cjs');
const { PAYMENTS_PROVIDER, STRIPE_WEBHOOK_SECRET } = require('../../config/payments.cjs');

async function handleStripeWebhook(req) {
  let stripe;
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
  } catch (_e) {
    const err = new Error('STRIPE_SDK_NOT_INSTALLED (run: npm i stripe)');
    err.status = 500;
    throw err;
  }

  const sig = req.headers['stripe-signature'];
  if (!STRIPE_WEBHOOK_SECRET) {
    const err = new Error('STRIPE_WEBHOOK_SECRET_MISSING');
    err.status = 500;
    throw err;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    const err = new Error('WEBHOOK_SIGNATURE_INVALID');
    err.status = 400;
    err.detail = e.message;
    throw err;
  }

  // We care about checkout.session.completed (paid)
  if (event.type !== 'checkout.session.completed') return { ok: true };

  const session = event.data.object;
  const sessionId = session.id;

  const order = await OrdersRepo.findOrderByProviderSessionId(sessionId);
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND_FOR_SESSION');
    err.status = 404;
    throw err;
  }

  const paid = await OrdersRepo.markOrderPaid({
    orderId: order.id,
    providerPaymentIntentId: session.payment_intent || null,
  });

  if (paid) {
    await EntitlementsRepo.ensureEntitlementForOrder(paid);
  }

  return { ok: true };
}

async function handleFakeWebhook(req) {
  // Expected payload:
  // { type: "checkout.session.completed", data: { object: { id: "fake_xxx", payment_intent: "pi_fake" } } }
  const body = req.body || {};
  const type = body.type;
  const sessionId = body?.data?.object?.id;

  if (type !== 'checkout.session.completed' || !sessionId) {
    const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
    err.status = 400;
    throw err;
  }

  const order = await OrdersRepo.findOrderByProviderSessionId(sessionId);
  if (!order) {
    const err = new Error('ORDER_NOT_FOUND_FOR_SESSION');
    err.status = 404;
    throw err;
  }

  const paid = await OrdersRepo.markOrderPaid({
    orderId: order.id,
    providerPaymentIntentId: body?.data?.object?.payment_intent || 'pi_fake',
  });

  if (paid) {
    await EntitlementsRepo.ensureEntitlementForOrder(paid);
  }

  return { ok: true };
}

async function webhook(req, res) {
  let result;
  if (PAYMENTS_PROVIDER === 'stripe') {
    result = await handleStripeWebhook(req);
  } else {
    result = await handleFakeWebhook(req);
  }
  return res.status(200).json(result);
}

module.exports = {
  webhook,
};
