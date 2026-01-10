'use strict';

const PAYMENTS_PROVIDER = (process.env.PAYMENTS_PROVIDER || 'fake').toLowerCase();

// базовый URL приложения (нужен для callback/redirect)
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || `${APP_BASE_URL}/profile`;
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || `${APP_BASE_URL}/templates`;

// Fake
const FAKE_PAYMENTS_ENABLED = (process.env.FAKE_PAYMENTS_ENABLED || '1') !== '0';

module.exports = {
  // то, что ждёт текущий CJS-код
  PAYMENTS_PROVIDER,
  APP_BASE_URL,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL,

  // структурный доступ (если где-то используется)
  provider: PAYMENTS_PROVIDER,
  stripe: {
    secretKey: STRIPE_SECRET_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    successUrl: STRIPE_SUCCESS_URL,
    cancelUrl: STRIPE_CANCEL_URL,
  },
  fake: {
    enabled: FAKE_PAYMENTS_ENABLED,
  },
};
