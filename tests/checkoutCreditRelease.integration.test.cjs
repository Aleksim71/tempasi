// path: tests/checkoutCreditRelease.integration.test.cjs
/* eslint-env jest, node */
'use strict';

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.PAYMENTS_PROVIDER = 'fake';
process.env.APP_BASE_URL = 'http://localhost:3000';

const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createPendingOrderWithReservedCredit(db, {
  userId,
  templateSlug,
  providerSessionId,
  amountCents = 1000,
  creditCents = 350,
  dealType = 'BUY',
} = {}) {
  const creditResult = await db.query(
    `
    INSERT INTO public.account_credits (
      user_id,
      source_type,
      source_order_id,
      related_order_id,
      amount_cents,
      currency,
      status,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      'rent_conversion',
      NULL,
      NULL,
      $2,
      'EUR',
      'active',
      now() + interval '7 days',
      now(),
      now()
    )
    RETURNING *
    `,
    [userId, creditCents],
  );

  const orderResult = await db.query(
    `
    INSERT INTO public.orders (
      user_id,
      template_slug,
      deal_type,
      license,
      amount_cents,
      currency,
      status,
      provider,
      provider_session_id,
      created_at,
      updated_at
    )
    VALUES (
      $1,
      $2,
      $3,
      'PU',
      $4,
      'EUR',
      'pending',
      'fake',
      $5,
      now(),
      now()
    )
    RETURNING *
    `,
    [userId, templateSlug, dealType, amountCents, providerSessionId],
  );

  jest.resetModules();
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  process.env.PAYMENTS_PROVIDER = 'fake';
  process.env.APP_BASE_URL = 'http://localhost:3000';

  const CheckoutCreditsService = require('../src/modules/payments/checkoutCredits.service.cjs');

  const reservation = await CheckoutCreditsService.reserveCreditForOrder(db, {
    userId,
    orderId: orderResult.rows[0].id,
    grossAmountCents: amountCents,
  });

  expect(reservation.creditAppliedCents).toBe(creditCents);
  expect(reservation.payableAmountCents).toBe(amountCents - creditCents);

  const reserved = await readCreditUsageAndOrder(db, orderResult.rows[0].id);
  expect(reserved.usage_status).toBe('reserved');
  expect(Number(reserved.usage_amount_cents)).toBe(creditCents);
  expect(reserved.order_status).toBe('pending');
  expect(Number(reserved.credit_applied_cents)).toBe(creditCents);
  expect(Number(reserved.payable_amount_cents)).toBe(amountCents - creditCents);

  return {
    credit: creditResult.rows[0],
    order: orderResult.rows[0],
    reservation,
  };
}

async function readCreditUsageAndOrder(db, orderId) {
  const result = await db.query(
    `
    SELECT
      o.id AS order_id,
      o.status AS order_status,
      o.gross_amount_cents,
      o.credit_applied_cents,
      o.payable_amount_cents,
      acu.status AS usage_status,
      acu.amount_cents AS usage_amount_cents,
      acu.released_at,
      acu.applied_at
    FROM public.orders o
    LEFT JOIN public.account_credit_usages acu ON acu.order_id = o.id
    WHERE o.id = $1
    ORDER BY acu.id ASC
    LIMIT 1
    `,
    [orderId],
  );

  return result.rows[0] || null;
}

async function expectReservedCreditReleased(db, orderId, {
  expectedOrderStatus,
  amountCents = 1000,
  creditCents = 350,
} = {}) {
  const row = await readCreditUsageAndOrder(db, orderId);

  expect(row).toBeTruthy();
  expect(row.usage_status).toBe('released');
  expect(Number(row.usage_amount_cents)).toBe(creditCents);
  expect(row.released_at).toBeTruthy();
  expect(row.applied_at).toBeFalsy();

  if (expectedOrderStatus) {
    expect(row.order_status).toBe(expectedOrderStatus);
  }

  expect(Number(row.credit_applied_cents)).toBe(0);
  expect(Number(row.payable_amount_cents)).toBe(amountCents);

  const availableResult = await db.query(
    `
    SELECT
      COALESCE(SUM(c.amount_cents), 0)
      - COALESCE((
        SELECT SUM(u.amount_cents)
        FROM public.account_credit_usages u
        JOIN public.account_credits c2 ON c2.id = u.credit_id
        WHERE c2.user_id = c.user_id
          AND u.status IN ('reserved', 'applied')
      ), 0) AS available_cents
    FROM public.account_credits c
    WHERE c.user_id = (
      SELECT user_id FROM public.orders WHERE id = $1
    )
      AND c.status = 'active'
    GROUP BY c.user_id
    `,
    [orderId],
  );

  expect(Number(availableResult.rows[0].available_cents)).toBe(creditCents);
}

describe('reserved checkout credit release on failed/cancelled/expired checkout', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  test('explicit service release moves reserved credit back to available balance', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const suffix = uniqueSuffix();

      const { order } = await createPendingOrderWithReservedCredit(db, {
        userId,
        templateSlug: `step-6c-explicit-release-${suffix}`,
        providerSessionId: `fake_step_6c_explicit_${suffix}`,
      });

      jest.resetModules();
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

      const CheckoutCreditsService = require('../src/modules/payments/checkoutCredits.service.cjs');
      const released = await CheckoutCreditsService.releaseReservedCreditForOrder(db, order.id);

      expect(released).toHaveLength(1);
      expect(released[0].status).toBe('released');

      await expectReservedCreditReleased(db, order.id, {
        expectedOrderStatus: 'pending',
      });
    });
  });

  test('checkout cancel controller releases reserved credit and marks pending order failed', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const suffix = uniqueSuffix();
      const providerSessionId = `fake_step_6c_cancel_${suffix}`;

      const { order } = await createPendingOrderWithReservedCredit(db, {
        userId,
        templateSlug: `step-6c-cancel-release-${suffix}`,
        providerSessionId,
      });

      jest.resetModules();
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;

      const CheckoutCancelController = require('../src/modules/payments/checkoutCancel.controller.cjs');
      const result = await CheckoutCancelController.releaseReservedCreditByProviderSessionId(providerSessionId);

      expect(result.ok).toBe(true);
      expect(result.released).toBe(true);
      expect(result.releasedCredits).toHaveLength(1);
      expect(result.releasedCredits[0].status).toBe('released');

      await expectReservedCreditReleased(db, order.id, {
        expectedOrderStatus: 'failed',
      });
    });
  });

  test.each([
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ])('fake webhook %s releases reserved credit and marks pending order failed', async (eventType) => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const suffix = uniqueSuffix();
      const providerSessionId = `fake_step_6c_webhook_${eventType.replaceAll('.', '_')}_${suffix}`;

      const { order } = await createPendingOrderWithReservedCredit(db, {
        userId,
        templateSlug: `step-6c-webhook-release-${eventType.replaceAll('.', '-')}-${suffix}`,
        providerSessionId,
      });

      jest.resetModules();
      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';

      const WebhookController = require('../src/modules/payments/webhook.controller.cjs');

      const req = {
        body: {
          type: eventType,
          data: {
            object: {
              id: providerSessionId,
            },
          },
        },
      };

      let result;
      if (typeof WebhookController.handleFakeWebhook === 'function') {
        result = await WebhookController.handleFakeWebhook(req);
      } else if (typeof WebhookController.releaseReservedCreditByProviderSessionId === 'function') {
        result = await WebhookController.releaseReservedCreditByProviderSessionId(providerSessionId);
      } else if (typeof WebhookController.webhook === 'function') {
        const res = {
          statusCode: 200,
          payload: null,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(payload) {
            this.payload = payload;
            return this;
          },
        };
        await WebhookController.webhook(req, res);
        result = res.payload;
      } else {
        throw new Error('No supported webhook export found for Step 6C test');
      }

      expect(result.ok).toBe(true);
      expect(result.released).toBe(true);
      expect(result.releasedCredits).toHaveLength(1);
      expect(result.releasedCredits[0].status).toBe('released');

      await expectReservedCreditReleased(db, order.id, {
        expectedOrderStatus: 'failed',
      });
    });
  });
});
