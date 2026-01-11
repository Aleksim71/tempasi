'use strict';

const { APP_BASE_URL, STRIPE_SECRET_KEY } = require('../../../config/payments.cjs');

/**
 * Stripe provider (Checkout Session).
 * Requires: npm i stripe
 * Env:
 * - PAYMENTS_PROVIDER=stripe
 * - STRIPE_SECRET_KEY=...
 * - APP_BASE_URL=https://your-domain
 */
async function createCheckoutSession(req, { order }) {
  let Stripe;
  try {
    Stripe = require('stripe');
  } catch (_e) {
    const err = new Error('STRIPE_SDK_NOT_INSTALLED (run: npm i stripe)');
    err.status = 500;
    throw err;
  }

  if (!STRIPE_SECRET_KEY) {
    const err = new Error('STRIPE_SECRET_KEY_MISSING');
    err.status = 500;
    throw err;
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);

  const successUrl = `${APP_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${APP_BASE_URL}/checkout/cancel?session_id={CHECKOUT_SESSION_ID}`;

  // NOTE: You can enrich with product name/preview later.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: (order.currency || 'EUR').toLowerCase(),
          unit_amount: order.amount_cents,
          product_data: {
            name: `Template ${order.template_slug} (${order.deal_type})`,
          },
        },
      },
    ],
    client_reference_id: String(order.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      order_id: String(order.id),
      template_slug: String(order.template_slug),
      deal_type: String(order.deal_type),
      user_id: String(order.user_id),
    },
  });

  return { id: session.id, url: session.url };
}

module.exports = {
  createCheckoutSession,
};
