// tests/entitlements.repo.test.cjs
/* eslint-env node */
'use strict';

// IMPORTANT:
// Canonical repos use pool from src/config/db.cjs which reads DATABASE_URL.
// Our tests use DATABASE_URL_TEST. Force canonical repos to point to TEST DB.
if (process.env.DATABASE_URL_TEST && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

const EntitlementsRepo = require('../src/modules/payments/repos/entitlements.repo.cjs');

async function createPaidOrderViaDb(db, { userId, templateSlug, dealType }) {
  // orders.license is NOT NULL in your schema, so we must provide it.
  // Use any valid license for BUY flows (matches your API validation list).
  const license = 'PU';
  const amountCents = 0;
  const currency = 'EUR';
  const provider = 'fake';

  const ins = await db.query(
    `
    INSERT INTO public.orders (user_id, template_slug, deal_type, license, amount_cents, currency, provider, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING *
    `,
    [userId, templateSlug, dealType, license, amountCents, currency, provider]
  );

  const order = ins.rows[0];

  // Mark paid (idempotency on order status is tested elsewhere; here we just need paid order)
  const upd = await db.query(
    `
    UPDATE public.orders
       SET status = 'paid',
           provider_payment_intent_id = COALESCE(provider_payment_intent_id, 'pi_test'),
           updated_at = now()
     WHERE id = $1
     RETURNING *
    `,
    [order.id]
  );

  return upd.rows[0];
}

describe('entitlements.repo (canonical)', () => {
  test('ensureEntitlementForOrder creates entitlement row', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const paid = await createPaidOrderViaDb(db, {
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
      });

      const ent = await EntitlementsRepo.ensureEntitlementForOrder(paid);

      expect(ent).toBeTruthy();
      expect(ent).toHaveProperty('order_id', paid.id);
      expect(ent).toHaveProperty('template_slug', 'seed-001');
    });
  });

  test('listUserEntitlements returns array', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const paid = await createPaidOrderViaDb(db, {
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
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

      const paid = await createPaidOrderViaDb(db, {
        userId,
        templateSlug: 'seed-001',
        dealType: 'BUY',
      });

      // Call twice (simulate duplicate webhook / retry)
      const ent1 = await EntitlementsRepo.ensureEntitlementForOrder(paid);
      const ent2 = await EntitlementsRepo.ensureEntitlementForOrder(paid);

      expect(ent1).toBeTruthy();
      expect(ent2).toBeTruthy();
      expect(ent1.order_id).toBe(paid.id);
      expect(ent2.order_id).toBe(paid.id);

      // Assert single row in DB for this order_id (unique index + ON CONFLICT path)
      const r = await db.query(`SELECT COUNT(*)::int AS n FROM entitlements WHERE order_id = $1`, [paid.id]);
      expect(r.rows[0].n).toBe(1);
    });
  });
});
