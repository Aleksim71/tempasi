// tests/paymentCompletion.service.test.cjs
/* eslint-env node */
'use strict';

// Canonical repos use pool from src/config/db.cjs which reads DATABASE_URL.
// Tests use DATABASE_URL_TEST. Force canonical repos to point to TEST DB.
if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

const PaymentCompletion = require('../src/modules/payments/paymentCompletion.service.cjs');

async function createPendingOrder(db, { userId, templateSlug = 'seed-payment-completion-1', dealType = 'BUY' }) {
  const result = await db.query(
    `
    INSERT INTO public.orders (
      user_id,
      template_slug,
      deal_type,
      license,
      amount_cents,
      currency,
      provider,
      provider_session_id,
      status
    )
    VALUES ($1, $2, $3, 'PU', 1000, 'EUR', 'fake', $4, 'pending')
    RETURNING *
    `,
    [userId, templateSlug, dealType, `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`],
  );

  return result.rows[0];
}

describe('paymentCompletion.service', () => {
  test('completePaidOrder marks order paid and creates entitlement', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const pending = await createPendingOrder(db, { userId });

      const completed = await PaymentCompletion.completePaidOrder({
        orderId: pending.id,
        providerPaymentIntentId: `pi_${Date.now()}`,
        providerSessionId: pending.provider_session_id,
      });

      expect(completed).toBeTruthy();
      expect(completed.order).toBeTruthy();
      expect(completed.order.id).toBe(pending.id);
      expect(completed.order.status).toBe('paid');

      expect(completed.entitlement).toBeTruthy();
      expect(completed.entitlement.order_id).toBe(pending.id);
      expect(completed.entitlement.template_slug).toBe('seed-payment-completion-1');

      const orderCheck = await db.query(
        `SELECT id, status FROM public.orders WHERE id = $1`,
        [pending.id],
      );
      expect(orderCheck.rows[0].status).toBe('paid');

      const entitlementCheck = await db.query(
        `SELECT COUNT(*)::int AS n FROM public.entitlements WHERE order_id = $1`,
        [pending.id],
      );
      expect(entitlementCheck.rows[0].n).toBe(1);
    });
  });

  test('completePaidOrder is idempotent for already-paid order', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);
      const pending = await createPendingOrder(db, { userId, templateSlug: 'seed-payment-completion-2' });

      const args = {
        orderId: pending.id,
        providerPaymentIntentId: `pi_${Date.now()}`,
        providerSessionId: pending.provider_session_id,
      };

      const first = await PaymentCompletion.completePaidOrder(args);
      const second = await PaymentCompletion.completePaidOrder(args);

      expect(first.order.id).toBe(pending.id);
      expect(second.order.id).toBe(pending.id);
      expect(first.entitlement.order_id).toBe(pending.id);
      expect(second.entitlement.order_id).toBe(pending.id);

      const entitlementCheck = await db.query(
        `SELECT COUNT(*)::int AS n FROM public.entitlements WHERE order_id = $1`,
        [pending.id],
      );
      expect(entitlementCheck.rows[0].n).toBe(1);
    });
  });
});
