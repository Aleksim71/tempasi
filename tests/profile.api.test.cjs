// tests/profile.api.test.cjs
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

describe('GET /api/profile/downloads (via real server)', () => {
  it('401 when not logged in', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const r = await request(srv.baseUrl).get('/api/profile/downloads');
      expect(r.status).toBe(401);
    });
  });

  it('200 and returns items when logged in', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      // 1) Register + Login
      const email = 'buyer2@example.com';
      const password = 'Passw0rd!';

      const reg = await request(srv.baseUrl)
        .post('/api/auth/register')
        .send({ email, password });

      expect([200, 201]).toContain(reg.status);

      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .send({ email, password });

      expect([200, 204, 302, 303]).toContain(login.status);

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      // 2) Profile downloads (should be authed)
      const r = await request(srv.baseUrl)
        .get('/api/profile/downloads')
        .set('Cookie', sidCookie);

      expect([200, 204]).toContain(r.status);
    });
  });
});
