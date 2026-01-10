'use strict';

/**
 * Tempasi — Payments config (B12)
 *
 * Providers:
 * - fake  : local/dev provider (no real money)
 * - stripe: Stripe Checkout + webhook (needs stripe keys)
 */

function getEnv(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const PAYMENTS_PROVIDER = getEnv('PAYMENTS_PROVIDER', 'fake'); // 'fake' | 'stripe'

// Public base URL of your app (needed for redirect URLs)
const APP_BASE_URL = getEnv('APP_BASE_URL', 'http://localhost:3000');

// Stripe (only if PAYMENTS_PROVIDER=stripe)
const STRIPE_SECRET_KEY = getEnv('STRIPE_SECRET_KEY', '');
const STRIPE_WEBHOOK_SECRET = getEnv('STRIPE_WEBHOOK_SECRET', '');

module.exports = {
  PAYMENTS_PROVIDER,
  APP_BASE_URL,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
};
