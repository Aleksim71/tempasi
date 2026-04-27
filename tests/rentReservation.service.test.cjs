// tests/rentReservation.service.test.cjs
/* eslint-env node */
'use strict';

if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

const OrdersService = require('../src/modules/orders/orders.service.cjs');
const EntitlementsRepo = require('../src/modules/payments/repos/entitlements.repo.cjs');

async function createPaidRentOrder(db, { userId, templateSlug }) {
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
      provider_payment_intent_id,
      status
    )
    VALUES ($1, $2, 'RENT', 'PU', 100, 'EUR', 'fake', $3, $4, 'paid')
    RETURNING *
    `,
    [
      userId,
      templateSlug,
      `rent_sess_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      `rent_pi_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ],
  );

  return result.rows[0];
}

describe('rent reservation business rules', () => {
  test('active RENT blocks BUY by another user', async () => {
    await withDb(async (db) => {
      const renterUserId = await createTestUser(db);
      const otherUserId = await createTestUser(db);
      const templateSlug = `rent-reserved-${Date.now()}-1`;

      const rentOrder = await createPaidRentOrder(db, {
        userId: renterUserId,
        templateSlug,
      });

      const entitlement = await EntitlementsRepo.ensureEntitlementForOrder(rentOrder);

      expect(entitlement).toBeTruthy();
      expect(String(entitlement.kind).toLowerCase()).toBe('rent');
      expect(String(entitlement.deal_type).toUpperCase()).toBe('RENT');
      expect(entitlement.ends_at).toBeTruthy();

      await expect(
        OrdersService.createPendingOrder({
          userId: otherUserId,
          templateSlug,
          payload: { license: 'PU', dealType: 'BUY' },
        }),
      ).rejects.toMatchObject({
        code: 'TEMPLATE_RENT_RESERVED',
        status: 409,
      });
    });
  });

  test('active RENT allows BUY by the current renter', async () => {
    await withDb(async (db) => {
      const renterUserId = await createTestUser(db);
      const templateSlug = `rent-reserved-${Date.now()}-2`;

      const rentOrder = await createPaidRentOrder(db, {
        userId: renterUserId,
        templateSlug,
      });

      await EntitlementsRepo.ensureEntitlementForOrder(rentOrder);

      const buyOrder = await OrdersService.createPendingOrder({
        userId: renterUserId,
        templateSlug,
        payload: { license: 'PU', dealType: 'BUY' },
      });

      expect(buyOrder).toBeTruthy();
      expect(buyOrder.user_id).toBe(renterUserId);
      expect(buyOrder.template_slug).toBe(templateSlug);
      expect(String(buyOrder.deal_type).toUpperCase()).toBe('BUY');
      expect(String(buyOrder.status).toLowerCase()).toBe('pending');
    });
  });
});
