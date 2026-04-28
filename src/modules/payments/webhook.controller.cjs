'use strict';

const PaymentCompletion = require('./paymentCompletion.service.cjs');
const OrdersRepo = require('../orders/orders.repo.cjs');
const CheckoutCreditsService = require('./checkoutCredits.service.cjs');
const db = require('../../config/db.cjs');
const { PAYMENTS_PROVIDER, STRIPE_WEBHOOK_SECRET } = require('../../config/payments.cjs');

// TEMPASI_STEP_5F_RELEASE_RESERVED_CREDIT
const RELEASE_RESERVED_CREDIT_EVENT_TYPES = new Set([
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
]);

async function releaseReservedCreditByProviderSessionId(providerSessionId) {
  if (!providerSessionId) {
    const err = new Error('PROVIDER_SESSION_ID_REQUIRED');
    err.status = 400;
    throw err;
  }

  const order = await OrdersRepo.findOrderByProviderSessionId(providerSessionId);
  if (!order) {
    return {
      ok: true,
      released: false,
      orderId: null,
      reason: 'ORDER_NOT_FOUND_FOR_PROVIDER_SESSION',
    };
  }

  const releasedCredits = await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);

  let failedOrder = order;
  if (String(order.status || '').toLowerCase() === 'pending' && typeof OrdersRepo.markOrderFailed === 'function') {
    failedOrder = await OrdersRepo.markOrderFailed({ orderId: order.id }) || order;
  }

  return {
    ok: true,
    released: true,
    orderId: order.id,
    orderStatus: failedOrder?.status || order.status || null,
    releasedCredits,
  };
}


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

  const session = event.data.object;
  const sessionId = session.id;

  if (event.type === 'checkout.session.completed') {
    const completed = await PaymentCompletion.completePaidOrder({
      providerSessionId: sessionId,
      providerPaymentIntentId: session.payment_intent || null,
    });

    return {
      ok: true,
      orderId: completed?.order?.id || null,
    };
  }

  if (RELEASE_RESERVED_CREDIT_EVENT_TYPES.has(event.type)) {
    return releaseReservedCreditByProviderSessionId(sessionId);
  }

  return { ok: true };
}

async function handleFakeWebhook(req) {
  // Expected payload:
  // { type: "checkout.session.completed", data: { object: { id: "fake_xxx", payment_intent: "pi_fake" } } }
  const body = req.body || {};
  const type = body.type;
  const sessionId = body?.data?.object?.id;

  if (!sessionId) {
    const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
    err.status = 400;
    throw err;
  }

  if (type === 'checkout.session.completed') {
    const completed = await PaymentCompletion.completePaidOrder({
      providerSessionId: sessionId,
      providerPaymentIntentId: body?.data?.object?.payment_intent || 'pi_fake',
    });

    return {
      ok: true,
      orderId: completed?.order?.id || null,
    };
  }

  if (RELEASE_RESERVED_CREDIT_EVENT_TYPES.has(type)) {
    return releaseReservedCreditByProviderSessionId(sessionId);
  }

  const err = new Error('INVALID_FAKE_WEBHOOK_PAYLOAD');
  err.status = 400;
  throw err;
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
