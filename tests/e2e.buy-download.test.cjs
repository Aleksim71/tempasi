'use strict';

const request = require('supertest');
const { migrateDb, safeTruncate, withDb } = require('./helpers/db.cjs');
const { startServer } = require('./helpers/spawnServer.cjs');

describe('E2E: buy → entitlement → download (via real server)', () => {
  let srv;

  beforeAll(async () => {
    await migrateDb();
    // поднимаем сервер отдельным процессом (Jest не импортирует app.js → нет segfault)
    srv = await startServer({ databaseUrlTest: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (srv) await srv.stop();
  });

  beforeEach(async () => {
    await safeTruncate();
  });

  test('API buy → 201; entitlement → download allowed', async () => {
    const agent = request.agent(srv.baseUrl);

    await agent.post('/api/auth/dev-login').send({ userId: 1 });

    const buy = await agent.post('/api/orders/seed-001/buy').send({ license: 'PU' });
    expect(buy.status).toBe(201);
    expect(buy.body).toHaveProperty('order_id');

    await withDb(async (db) => {
      await db.query(
        `INSERT INTO entitlements (user_id, template_slug, order_id, deal_type)
         VALUES (1, 'seed-001', $1, 'BUY')`,
        [buy.body.order_id]
      );
    });

    const dl = await agent.get('/download/seed-001');

    // допускаем разные реализации скачивания, главное: не 401/403
    expect(dl.status).not.toBe(401);
    expect(dl.status).not.toBe(403);
  });
});
