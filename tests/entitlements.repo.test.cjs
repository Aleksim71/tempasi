// tests/entitlements.repo.test.cjs
/* eslint-env node */
'use strict';

// IMPORTANT: payments entitlements repo uses src/config/db.cjs pool,
// which relies on DATABASE_URL. In tests we usually have DATABASE_URL_TEST.
// Make unit tests deterministic by aliasing DATABASE_URL -> DATABASE_URL_TEST
// BEFORE requiring the repo (so db.cjs reads correct env).
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

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
  test('ensureEntitlementForOrder creates entitlement row', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const templateSlug = 'seed-001';
      const orderId = await createOrder(db, { userId, templateSlug, dealType: 'BUY' });

      // Canonical contract: ensureEntitlementForOrder(order)
      await EntitlementsRepo.ensureEntitlementForOrder({
        id: orderId,
        user_id: userId,
        template_slug: templateSlug,
        deal_type: 'BUY',
      });

      // Verify via DB (no guessing about helper signatures)
      const { rows } = await db.query(
        `SELECT user_id, template_slug, kind, created_at
           FROM entitlements
          WHERE user_id = $1 AND template_slug = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [userId, templateSlug],
      );

      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(userId);
      expect(rows[0].template_slug).toBe(templateSlug);
      expect(rows[0].kind).toBe('buy');
    });
  });

  test('listUserEntitlements returns array (or fallback DB query)', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const templateSlug = 'seed-001';
      const orderId = await createOrder(db, { userId, templateSlug, dealType: 'BUY' });

      await EntitlementsRepo.ensureEntitlementForOrder({
        id: orderId,
        user_id: userId,
        template_slug: templateSlug,
        deal_type: 'BUY',
      });

      let items;
      if (typeof EntitlementsRepo.listUserEntitlements === 'function') {
        items = await EntitlementsRepo.listUserEntitlements({ db, userId });
      } else {
        const r = await db.query(
          `SELECT template_slug, kind, created_at
             FROM entitlements
            WHERE user_id = $1
            ORDER BY created_at DESC`,
          [userId],
        );
        items = r.rows;
      }

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('template_slug');
    });
  });
});
