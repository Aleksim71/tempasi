// tests/e2e.buy-download.test.cjs
/* eslint-env node */
'use strict';

const request = require('supertest');
const pg = require('pg');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withRealServer } = require('./helpers/realServer.cjs');

// Robust cookie picker: supports different session cookie names
function pickSidCookie(setCookieHeader) {
  const arr = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  if (!arr.length) return null;

  const re = /^(sid|connect\.sid|tempasi\.sid|tempasi_sid|tp\.sid|session|sess|sid_cookie)=/i;

  for (const raw of arr) {
    const firstPart = String(raw).split(';')[0].trim();
    const name = firstPart.split('=')[0];
    if (re.test(`${name}=`)) return firstPart;
  }

  for (const raw of arr) {
    const s = String(raw);
    if (/httponly/i.test(s)) return s.split(';')[0].trim();
  }

  return null;
}

/**
 * Seed a minimal template row so BUY route doesn't 400 on "template not found".
 * We intentionally try multiple possible schemas to match evolving DB.
 */
async function seedTemplateSeed001() {
  const connectionString = process.env.DATABASE_URL_TEST || '';
  if (!connectionString) return;

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  const slug = 'seed-001';

  const attempts = [
    {
      sql: `
        INSERT INTO templates (slug, title, price_cents, zip_path)
        VALUES ($1, 'Seed Template', 1000, '/downloads/seed-001.zip')
        ON CONFLICT (slug) DO NOTHING;
      `,
      params: [slug],
    },
    {
      sql: `
        INSERT INTO templates (slug, title, price_cents, zip_ready)
        VALUES ($1, 'Seed Template', 1000, true)
        ON CONFLICT (slug) DO NOTHING;
      `,
      params: [slug],
    },
    {
      sql: `
        INSERT INTO templates (slug, title, price_cents)
        VALUES ($1, 'Seed Template', 1000)
        ON CONFLICT (slug) DO NOTHING;
      `,
      params: [slug],
    },
    {
      sql: `
        INSERT INTO template_assets (template_slug, zip_path)
        VALUES ($1, '/downloads/seed-001.zip')
        ON CONFLICT DO NOTHING;
      `,
      params: [slug],
    },
  ];

  try {
    await client.query('BEGIN');
    for (const a of attempts) {
      try {
        await client.query(a.sql, a.params);
      } catch {
        // ignore schema mismatch
      }
    }
    await client.query('COMMIT');
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {}
  } finally {
    client.release();
    await pool.end();
  }
}

describe('E2E: buy → entitlement → download (via real server)', () => {
  it('API buy → 201; entitlement → download allowed', async () => {
    await migrateDb();
    await seedTemplateSeed001();

    await withRealServer(async (srv) => {
      const email = `e2e_${Date.now()}@example.com`;
      const password = 'Test12345__';

      // 1) Register
      const reg = await request(srv.baseUrl)
        .post('/api/auth/register')
        .send({ email, password });

      expect([200, 201, 303]).toContain(reg.status);

      // 2) Login
      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .send({ email, password });

      // eslint-disable-next-line no-console
      console.log('[e2e login]', {
        status: login.status,
        setCookie: Array.isArray(login.headers['set-cookie'])
          ? login.headers['set-cookie'][0]
          : login.headers['set-cookie'],
        body: login.body,
        text: login.text,
      });

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      // 3) Buy
      // ✅ FIX: BUY endpoint requires license in body
      const buy = await request(srv.baseUrl)
        .post('/api/orders/seed-001/buy')
        .set('Cookie', sidCookie)
        .send({ license: 'PU', deal_type: 'BUY' });

      // eslint-disable-next-line no-console
      console.log('[e2e buy]', { status: buy.status, text: buy.text, body: buy.body });

      expect([200, 201]).toContain(buy.status);

      // 4) Download should be allowed
      const dl = await request(srv.baseUrl)
        .get('/api/profile/downloads')
        .set('Cookie', sidCookie);

      expect(dl.status).toBe(200);
      expect(dl.body).toBeTruthy();
    });
  });
});
