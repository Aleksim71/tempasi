// tests/e2e.buy-download.test.cjs
/* eslint-env node */
'use strict';

const request = require('supertest');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withRealServer } = require('./helpers/realServer.cjs');

// Robust cookie picker: supports different session cookie names
function pickSidCookie(setCookieHeader) {
  const arr = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  if (!arr.length) return null;

  // Common names for express-session / custom session cookies
  const re = /^(sid|connect\.sid|tempasi\.sid|tempasi_sid|tp\.sid|session|sess|sid_cookie)=/i;

  // 1) prefer known names
  for (const raw of arr) {
    const firstPart = String(raw).split(';')[0].trim(); // "name=value"
    const name = firstPart.split('=')[0];
    if (re.test(`${name}=`)) return firstPart;
  }

  // 2) fallback: any HttpOnly cookie
  for (const raw of arr) {
    const s = String(raw);
    if (/httponly/i.test(s)) return s.split(';')[0].trim();
  }

  return null;
}

describe('E2E: buy → entitlement → download (via real server)', () => {
  it('API buy → 201; entitlement → download allowed', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      // 1) Register
      const email = 'buyer1@example.com';
      const password = 'Passw0rd!';

      const reg = await request(srv.baseUrl)
        .post('/api/auth/register')
        .send({ email, password });

      expect([200, 201]).toContain(reg.status);

      // 2) Login (expect Set-Cookie)
      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .send({ email, password });

      expect([200, 204, 302, 303]).toContain(login.status);

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      // 3) Buy
      const buy = await request(srv.baseUrl)
        .post('/api/orders/seed-001/buy')
        .set('Cookie', sidCookie)
        .send({ dealType: 'BUY', amount: 1000, currency: 'EUR' });

      expect([200, 201]).toContain(buy.status);

      // 4) Download should be allowed
      const dl = await request(srv.baseUrl)
        .get('/api/templates/seed-001/download')
        .set('Cookie', sidCookie);

      expect([200, 302, 303]).toContain(dl.status);
    });
  });
});
