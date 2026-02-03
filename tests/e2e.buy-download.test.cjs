'use strict';

const request = require('supertest');
const { startServer } = require('./helpers/spawnServer.cjs');
const { withDb } = require('./helpers/db.cjs');
const { createTestUser } = require('./helpers/user.cjs');

function loadMigrate() {
  const variants = [
    './helpers/migrateDb.cjs',
    './helpers/migrate.db.cjs',
    './helpers/migrate.cjs',
    './helpers/db.migrate.cjs',
  ];

  for (const p of variants) {
    try {
      // eslint-disable-next-line global-require
      const mod = require(p);
      const fn = mod.migrateDb || mod.migrate || mod.runMigrations || mod.default || null;
      if (typeof fn === 'function') return fn;
    } catch (_e) {
      // continue
    }
  }

  throw new Error(
    `Cannot resolve migrate helper. Tried:\n${variants.join('\n')}\n` +
      `Please check tests/helpers/ for the actual file name.`,
  );
}

function pickSidCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const line = arr.find((s) => String(s).toLowerCase().startsWith('sid='));
  if (!line) return null;
  return String(line).split(';')[0];
}

describe('E2E: buy → entitlement → download (via real server)', () => {
  let srv;

  beforeAll(async () => {
    const migrate = loadMigrate();
    await migrate();
    srv = await startServer({ databaseUrlTest: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (srv && srv.stop) await srv.stop();
  });

  test('API buy → 201; entitlement → download allowed', async () => {
    // 1) Ensure user exists in DB
    const userId = await withDb(async (db) => createTestUser(db));

    // 2) Dev-login
    const login = await request(srv.baseUrl).post('/api/auth/dev-login').send({ userId });

    if (login.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('DEV-LOGIN status=', login.status);
      // eslint-disable-next-line no-console
      console.error('DEV-LOGIN text=', login.text);
    }

    expect(login.status).toBe(200);

    const sidCookie = pickSidCookie(login.headers['set-cookie']);
    expect(sidCookie).toBeTruthy();

    // 3) Buy
    const buy = await request(srv.baseUrl)
      .post('/api/orders/seed-001/buy')
      .set('Cookie', sidCookie)
      .send({ license: 'PU' });

    if (buy.status !== 201) {
      // eslint-disable-next-line no-console
      console.error('BUY status=', buy.status);
      // eslint-disable-next-line no-console
      console.error('BUY text=', buy.text);
    }

    expect(buy.status).toBe(201);
    expect(buy.body).toHaveProperty('order_id');

    // 4) Entitlement exists
    await withDb(async (db) => {
      const { rows } = await db.query(
        `
        SELECT 1
        FROM entitlements
        WHERE user_id = $1 AND template_slug = $2
        LIMIT 1
        `,
        [userId, 'seed-001'],
      );
      expect(rows.length).toBe(1);
    });

    // 5) Download allowed (200 or redirect)
    const dl = await request(srv.baseUrl).get('/downloads/seed-001').set('Cookie', sidCookie);

    // 🔎 Debug on non-200/302
    if (![200, 302].includes(dl.status)) {
      // eslint-disable-next-line no-console
      console.error('DL status=', dl.status);
      // eslint-disable-next-line no-console
      console.error('DL text=', dl.text);
      // eslint-disable-next-line no-console
      console.error('DL headers=', dl.headers);
    }

    expect([200, 302]).toContain(dl.status);
  });
});
