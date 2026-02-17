// tests/entitlements.repo.test.cjs
/* eslint-env node */
'use strict';

const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

const OrdersRepo = require('../src/modules/orders/orders.repo.cjs');
const EntitlementsRepo = require('../src/modules/payments/repos/entitlements.repo.cjs');

describe('entitlements.repo (canonical)', () => {
  test('ensureEntitlementForOrder creates entitlement row', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      // create paid order row in DB (repo uses pool; but DB is the same test DB url)
      const order = await OrdersRepo.createOrder({
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
        amountCents: 0,
        currency: 'EUR',
        provider: 'fake',
      });

      const paid = await OrdersRepo.markOrderPaid({
        orderId: order.id,
        providerPaymentIntentId: 'pi_test',
      });

      expect(paid).toBeTruthy();

      const ent = await EntitlementsRepo.ensureEntitlementForOrder(paid);
      expect(ent).toBeTruthy();
      expect(ent).toHaveProperty('order_id', order.id);
      expect(ent).toHaveProperty('template_slug', 'seed-001');
    });
  });

  test('listUserEntitlements returns array', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const order = await OrdersRepo.createOrder({
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
        amountCents: 0,
        currency: 'EUR',
        provider: 'fake',
      });

      const paid = await OrdersRepo.markOrderPaid({
        orderId: order.id,
        providerPaymentIntentId: 'pi_test',
      });

      await EntitlementsRepo.ensureEntitlementForOrder(paid);

      const items = await EntitlementsRepo.listUserEntitlements({ db, userId });
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('template_slug');
      expect(items[0]).toHaveProperty('kind');
    });
  });

  test('ensureEntitlementForOrder is idempotent (same order_id -> single row)', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const order = await OrdersRepo.createOrder({
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
        amountCents: 0,
        currency: 'EUR',
        provider: 'fake',
      });

      const paid = await OrdersRepo.markOrderPaid({
        orderId: order.id,
        providerPaymentIntentId: 'pi_test',
      });

      // Call twice (simulate retry / duplicate webhook)
      const ent1 = await EntitlementsRepo.ensureEntitlementForOrder(paid);
      const ent2 = await EntitlementsRepo.ensureEntitlementForOrder(paid);

      expect(ent1).toBeTruthy();
      expect(ent2).toBeTruthy();
      expect(ent1.order_id).toBe(order.id);
      expect(ent2.order_id).toBe(order.id);

      // Assert single row in DB for this order_id
      const r = await db.query(`SELECT COUNT(*)::int AS n FROM entitlements WHERE order_id = $1`, [order.id]);
      expect(r.rows[0].n).toBe(1);
    });
  });
});
