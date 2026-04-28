'use strict';

const crypto = require('crypto');
const { APP_BASE_URL } = require('../../../config/payments.cjs');

/**
 * Fake provider: returns a local URL that simulates a success redirect.
 * Webhook is NOT automatic — you can trigger it manually:
 * POST /api/payments/fake/webhook/paid  { sessionId: "..." }
 */
async function createCheckoutSession(_req, { order }) {
  const sessionId = `fake_${crypto.randomBytes(12).toString('hex')}`;
  const payableAmountCents = Number(order.payable_amount_cents ?? order.payableAmountCents ?? order.amount_cents ?? 0);
  const url = `${APP_BASE_URL}/checkout/success?session_id=${encodeURIComponent(sessionId)}&order_id=${order.id}&payable_amount_cents=${payableAmountCents}`;
  return { id: sessionId, url };
}

module.exports = {
  createCheckoutSession,
};
