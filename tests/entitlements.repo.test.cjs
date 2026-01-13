'use strict';

const { migrateDb, safeTruncate, withDb } = require('./helpers/db.cjs');
const entRepo = require('../src/modules/entitlements/entitlements.repo.cjs');

describe('entitlements.repo', () => {
  beforeAll(async () => {
    await migrateDb();
  });

  beforeEach(async () => {
    await safeTruncate();
  });

  test('grantEntitlement + hasEntitlement', async () => {
    await withDb(async (db) => {
      const userId = 1;
      const templateSlug = 'seed-001';

      const granted = await entRepo.grantEntitlement({
        db,
        userId,
        templateSlug,
        orderId: 123,
      });

      expect(granted).toBeTruthy();
      expect(Number(granted.user_id)).toBe(Number(userId));
      expect(granted.template_slug).toBe(templateSlug);

      const ok = await entRepo.hasEntitlement({ db, userId, templateSlug });
      expect(ok).toBe(true);
    });
  });

  test('listUserEntitlements returns array', async () => {
    await withDb(async (db) => {
      await entRepo.grantEntitlement({ db, userId: 1, templateSlug: 'seed-001', orderId: 10 });
      await entRepo.grantEntitlement({ db, userId: 1, templateSlug: 'seed-002', orderId: 11 });

      const list = await entRepo.listUserEntitlements({ db, userId: 1 });
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(2);
      expect(list[0]).toHaveProperty('template_slug');
    });
  });
});
