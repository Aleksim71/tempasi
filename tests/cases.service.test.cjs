'use strict';

// tests/cases.service.test.cjs

const { getPool } = require('../scripts/db.pool.cjs');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const { createTestUser } = require('./helpers/user.cjs');
const casesService = require('../src/modules/cases/cases.service.cjs');

describe('cases.service', () => {
  let db;

  beforeAll(async () => {
    db = getPool();
    await migrateDb(db);
  });

  afterAll(async () => {
    if (db && typeof db.end === 'function') {
      await db.end();
    }
  });

  test('ensureDefaultCaseForUser creates the first case only once', async () => {
    const userId = await createTestUser(db);

    const created = await casesService.ensureDefaultCaseForUser(userId, db);
    expect(created).toBeTruthy();
    expect(created.title).toBe('My first client case');

    const second = await casesService.ensureDefaultCaseForUser(userId, db);
    expect(second).toBeNull();

    const cases = await casesService.getOwnerCases(userId, db);
    expect(cases).toHaveLength(1);
    expect(cases[0].title).toBe('My first client case');
  });

  test('deleteCase blocks deleting the last remaining case', async () => {
    const userId = await createTestUser(db);
    await casesService.ensureDefaultCaseForUser(userId, db);

    const cases = await casesService.getOwnerCases(userId, db);
    await expect(casesService.deleteCase(userId, cases[0].id, db)).rejects.toMatchObject({
      code: 'LAST_CASE_DELETE_BLOCKED',
    });

    const after = await casesService.getOwnerCases(userId, db);
    expect(after).toHaveLength(1);
  });

  test('deleteCase allows deleting one case when another case remains', async () => {
    const userId = await createTestUser(db);
    await casesService.ensureDefaultCaseForUser(userId, db);
    await casesService.create(userId, { title: 'Second client case' }, db);

    const before = await casesService.getOwnerCases(userId, db);
    expect(before).toHaveLength(2);

    await casesService.deleteCase(userId, before[0].id, db);

    const after = await casesService.getOwnerCases(userId, db);
    expect(after).toHaveLength(1);
  });
});
