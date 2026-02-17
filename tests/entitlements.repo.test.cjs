// tests/entitlements.repo.test.cjs
/* eslint-env node */
'use strict';

const { withDb } = require('./helpers/db.cjs');
const EntitlementsRepo = require('../src/modules/payments/repos/entitlements.repo.cjs');
const { createTestUser } = require('./helpers/user.cjs');

async function createOrder(db, { userId, templateSlug, dealType = 'BUY', license = 'PU' }) {
  // Keep schema-safe for current migrations (deal_type, amount_cents, currency, license).
  const amountCents = 0;
  const currency = 'EUR';

  const q = `
    INSERT INTO orders (user_id, template_slug, deal_type, license, amount_cents, currency)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `;
  const r = await db.query(q, [userId, templateSlug, dealType, license, amountCents, currency]);
  const id = r.rows[0] && r.rows[0].id;
  if (!id) throw new Error('TEST_ORDER_INSERT_FAILED');
  return String(id);
}

describe('entitlements.repo (canonical)', () => {
  test('ensureEntitlementForOrder + hasEntitlement', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const templateSlug = 'seed-001';
      const orderId = await createOrder(db, { userId, templateSlug, dealType: 'BUY' });

      // Canonical: entitlement is derived from an order
      await EntitlementsRepo.ensureEntitlementForOrder({
        db,
        order: { id: orderId, user_id: userId, template_slug: templateSlug, deal_type: 'BUY' },
      });

      const ok = await EntitlementsRepo.hasEntitlement({
        db,
        userId,
        templateSlug,
        kind: 'buy',
      });

      expect(ok).toBe(true);
    });
  });

  test('listUserEntitlements returns array', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const templateSlug = 'seed-001';
      const orderId = await createOrder(db, { userId, templateSlug, dealType: 'BUY' });

      await EntitlementsRepo.ensureEntitlementForOrder({
        db,
        order: { id: orderId, user_id: userId, template_slug: templateSlug, deal_type: 'BUY' },
      });

      const items = await EntitlementsRepo.listUserEntitlements({ db, userId });

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('template_slug');
      expect(items[0]).toHaveProperty('kind');
    });
  });
});
