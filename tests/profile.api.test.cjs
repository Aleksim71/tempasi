'use strict';

const request = require('supertest');
const { migrateDb, safeTruncate, withDb } = require('./helpers/db.cjs');
const { startServer } = require('./helpers/spawnServer.cjs');

describe('GET /api/profile/downloads (via real server)', () => {
  let srv;

  beforeAll(async () => {
    await migrateDb();
    srv = await startServer({ databaseUrlTest: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (srv) await srv.stop();
  });

  beforeEach(async () => {
    await safeTruncate();
  });

  test('401 when not logged in', async () => {
    const agent = request.agent(srv.baseUrl);
    const res = await agent.get('/api/profile/downloads');
    expect(res.status).toBe(401);
  });

  test('200 and returns items when logged in', async () => {
    const agent = request.agent(srv.baseUrl);

    await agent.post('/api/auth/dev-login').send({ userId: 1 });

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO entitlements (user_id, template_slug, order_id, deal_type)
         VALUES (1, 'seed-001', 101, 'BUY')`
      );
    });

    const res = await agent.get('/api/profile/downloads');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0].template_slug).toBe('seed-001');
  });
});
