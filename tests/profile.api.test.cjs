// tests/profile.api.test.cjs
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

describe('GET /api/profile/downloads (via real server)', () => {
  let srv;

  beforeAll(async () => {
    const migrate = loadMigrate();
    await migrate();
    srv = await startServer({ databaseUrlTest: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (srv && srv.stop) await srv.stop();
  });

  test('401 when not logged in', async () => {
    const res = await request(srv.baseUrl).get('/api/profile/downloads');
    expect(res.status).toBe(401);
  });

  test('200 and returns items when logged in', async () => {
    // 1) Ensure user exists in DB (FK-safe)
    const userId = await withDb(async (db) => createTestUser(db));

    // 2) Dev-login for that user
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


    // 2.5) Seed entitlement so profile downloads returns items
    await withDb(async (db) => {
      const entRepo = require('../src/modules/entitlements/entitlements.repo.cjs');
      await entRepo.grantEntitlement({ db, userId, templateSlug: 'seed-001', dealType: 'BUY' });
    });

    // 3) Fetch downloads
    const res = await request(srv.baseUrl).get('/api/profile/downloads').set('Cookie', sidCookie);

    // 🔎 Debug on 500 / non-200
    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('PROFILE status=', res.status);
      // eslint-disable-next-line no-console
      console.error('PROFILE text=', res.text);
      // eslint-disable-next-line no-console
      console.error('PROFILE body=', res.body);
    }

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toHaveProperty('template_slug');
  });
});
