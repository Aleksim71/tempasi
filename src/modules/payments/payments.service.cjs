// src/modules/payments/payments.service.cjs
'use strict';

const { PAYMENTS_PROVIDER } = require('../../config/payments.cjs');

function pickProvider(name) {
  const n = String(name || '').toLowerCase();

  // We'll extend this later: stripe, paypal, etc.
  if (n === 'fake') return require('./providers/fake.provider.cjs');

  const err = new Error('UNKNOWN_PAYMENTS_PROVIDER');
  err.status = 500;
  err.details = { provider: n };
  throw err;
}

function assertFn(obj, fnName) {
  if (!obj || typeof obj[fnName] !== 'function') {
    const err = new TypeError(`Payments.${fnName} is not a function`);
    err.status = 500;
    err.details = {
      provider: PAYMENTS_PROVIDER,
      exportedKeys: obj ? Object.keys(obj) : null,
      fnName,
    };
    throw err;
  }
}

/**
 * Used by Orders flow:
 * createCheckoutSession(req, { order }) -> { id, url }
 */
async function createCheckoutSession(req, { order }) {
  const provider = pickProvider(PAYMENTS_PROVIDER);
  assertFn(provider, 'createCheckoutSession');
  return provider.createCheckoutSession(req, { order });
}

/**
 * Webhook handler (optional now).
 * If your provider does not support it yet, we keep a clear error.
 */
async function handleWebhook(req) {
  const provider = pickProvider(PAYMENTS_PROVIDER);

  // The fake provider doesn't implement a webhook yet (we only have createCheckoutSession)
  if (typeof provider.handleWebhook !== 'function') {
    const err = new Error('WEBHOOK_NOT_SUPPORTED_FOR_PROVIDER');
    err.status = 400;
    err.details = { provider: PAYMENTS_PROVIDER };
    throw err;
  }

  return provider.handleWebhook(req);
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
};
