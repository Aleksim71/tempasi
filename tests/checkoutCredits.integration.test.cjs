// path: tests/checkoutCredits.integration.test.cjs
'use strict';

const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withDb } = require('./helpers/db.cjs');

describe('checkout credit integration', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  test('active account credit reduces checkout amount and moves reserved usage to applied', async () => {
    await withDb(async (db) => {
      jest.resetModules();

      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const ordersService = require('../src/modules/orders/orders.service.cjs');
      const paymentCompletionService = require('../src/modules/payments/paymentCompletion.service.cjs');

      const userResult = await db.query(
        `
        INSERT INTO public.users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        `,
        [`credit-checkout-${Date.now()}@example.com`, 'test-password-hash'],
      );

      const userId = userResult.rows[0].id;
      const templateSlug = `credit-checkout-template-${Date.now()}`;

      await db.query(
        `
        INSERT INTO public.account_credits (
          user_id,
          source_type,
          source_order_id,
          related_order_id,
          amount_cents,
          currency,
          status,
          expires_at
        )
        VALUES ($1, 'test_credit_checkout', NULL, NULL, 350, 'EUR', 'active', now() + interval '90 days')
        `,
        [userId],
      );

      const checkout = await ordersService.createOrderCheckout(null, {
        userId,
        templateSlug,
        payload: {
          dealType: 'BUY',
          license: 'EX',
          amountCents: 1000,
          currency: 'EUR',
        },
      });

      expect(checkout.grossAmountCents).toBe(1000);
      expect(checkout.creditAppliedCents).toBe(350);
      expect(checkout.payableAmountCents).toBe(650);
      expect(checkout.checkoutUrl).toContain('payable_amount_cents=650');

      const reserved = await db.query(
        `
        SELECT acu.status, acu.amount_cents, o.gross_amount_cents, o.credit_applied_cents, o.payable_amount_cents
          FROM public.account_credit_usages acu
          JOIN public.orders o ON o.id = acu.order_id
         WHERE acu.order_id = $1
        `,
        [checkout.orderId],
      );

      expect(reserved.rows).toHaveLength(1);
      expect(reserved.rows[0].status).toBe('reserved');
      expect(Number(reserved.rows[0].amount_cents)).toBe(350);
      expect(Number(reserved.rows[0].gross_amount_cents)).toBe(1000);
      expect(Number(reserved.rows[0].credit_applied_cents)).toBe(350);
      expect(Number(reserved.rows[0].payable_amount_cents)).toBe(650);

      const completed = await paymentCompletionService.completePaidOrder({
        orderId: checkout.orderId,
        providerSessionId: checkout.sessionId,
        providerPaymentIntentId: 'pi_credit_checkout_test',
      });

      expect(completed.order.status).toBe('paid');
      expect(completed.appliedCredits).toHaveLength(1);
      expect(Number(completed.appliedCredits[0].amount_cents)).toBe(350);

      const applied = await db.query(
        `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(applied.rows).toHaveLength(1);
      expect(applied.rows[0].status).toBe('applied');
      expect(Number(applied.rows[0].amount_cents)).toBe(350);
    });
  });

  test('full account credit cover completes checkout internally without external provider session', async () => {
    await withDb(async (db) => {
      jest.resetModules();

      process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      process.env.PAYMENTS_PROVIDER = 'fake';
      process.env.APP_BASE_URL = 'http://localhost:3000';

      const ordersService = require('../src/modules/orders/orders.service.cjs');

      const userResult = await db.query(
        `
        INSERT INTO public.users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        `,
        [`zero-pay-credit-${Date.now()}@example.com`, 'test-password-hash'],
      );

      const userId = userResult.rows[0].id;
      const templateSlug = `zero-pay-template-${Date.now()}`;

      await db.query(
        `
        INSERT INTO public.account_credits (
          user_id,
          source_type,
          source_order_id,
          related_order_id,
          amount_cents,
          currency,
          status,
          expires_at
        )
        VALUES ($1, 'test_zero_pay_credit_checkout', NULL, NULL, 1000, 'EUR', 'active', now() + interval '90 days')
        `,
        [userId],
      );

      const checkout = await ordersService.createOrderCheckout(null, {
        userId,
        templateSlug,
        payload: {
          dealType: 'BUY',
          license: 'EX',
          amountCents: 1000,
          currency: 'EUR',
        },
      });

      expect(checkout.zeroPay).toBe(true);
      expect(checkout.sessionId).toContain('internal_credit_zero_pay:');
      expect(checkout.checkoutUrl).toContain('source=internal_credit_zero_pay');
      expect(checkout.checkoutUrl).not.toContain('payable_amount_cents=');
      expect(checkout.grossAmountCents).toBe(1000);
      expect(checkout.creditAppliedCents).toBe(1000);
      expect(checkout.payableAmountCents).toBe(0);

      const orderResult = await db.query(
        `
        SELECT id, status, provider_session_id, provider_payment_intent_id,
               gross_amount_cents, credit_applied_cents, payable_amount_cents
          FROM public.orders
         WHERE id = $1
        `,
        [checkout.orderId],
      );

      expect(orderResult.rows).toHaveLength(1);
      expect(orderResult.rows[0].status).toBe('paid');
      expect(orderResult.rows[0].provider_session_id).toContain('internal_credit_zero_pay:');
      expect(orderResult.rows[0].provider_payment_intent_id).toContain('internal_credit_zero_pay:');
      expect(Number(orderResult.rows[0].gross_amount_cents)).toBe(1000);
      expect(Number(orderResult.rows[0].credit_applied_cents)).toBe(1000);
      expect(Number(orderResult.rows[0].payable_amount_cents)).toBe(0);

      const usageResult = await db.query(
        `
        SELECT status, amount_cents
          FROM public.account_credit_usages
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(usageResult.rows).toHaveLength(1);
      expect(usageResult.rows[0].status).toBe('applied');
      expect(Number(usageResult.rows[0].amount_cents)).toBe(1000);

      const entitlementResult = await db.query(
        `
        SELECT id, order_id, user_id, template_slug, deal_type
          FROM public.entitlements
         WHERE order_id = $1
        `,
        [checkout.orderId],
      );

      expect(entitlementResult.rows).toHaveLength(1);
      expect(entitlementResult.rows[0].user_id).toBe(userId);
      expect(entitlementResult.rows[0].template_slug).toBe(templateSlug);
      expect(String(entitlementResult.rows[0].deal_type).toUpperCase()).toBe('BUY');
    });
  });

});
