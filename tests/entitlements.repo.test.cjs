// tests/entitlements.repo.test.cjs
/* eslint-env node */
'use strict';

const { withDb } = require('./helpers/db.cjs');
const entRepo = require('../src/modules/entitlements/entitlements.repo.cjs');
const { createTestUser } = require('./helpers/user.cjs');

describe('entitlements.repo', () => {
  test('grantEntitlement + hasEntitlement', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      const templateSlug = 'seed-001';
      const orderId = null;

      await entRepo.grantEntitlement({ db, userId, templateSlug, orderId, dealType: 'BUY' });

      const ok = await entRepo.hasEntitlement({ db, userId, templateSlug, dealType: 'BUY' });
      expect(ok).toBe(true);
    });
  });

  test('listUserEntitlements returns array', async () => {
    await withDb(async (db) => {
      const userId = await createTestUser(db);

      await entRepo.grantEntitlement({ db, userId, templateSlug: 'seed-001', dealType: 'BUY' });

      const items = await entRepo.listUserEntitlements({ db, userId, dealType: 'BUY' });

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('template_slug');
    });
  });
});
