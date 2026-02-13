// tests/profile.api.test.cjs
/* eslint-env node */
'use strict';

const request = require('supertest');
const { migrateDb } = require('./helpers/migrateDb.cjs');
const { withRealServer } = require('./helpers/realServer.cjs');

// Robust cookie picker
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
      const r = await request(srv.baseUrl)
        .get('/api/profile/downloads')
        .set(srv.headers);

      expect([401, 403]).toContain(r.status);
    });
  });

  it('200 and returns items when logged in', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `t_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';

      const reg = await request(srv.baseUrl)
        .post('/api/auth/register')
        .set(srv.headers)
        .send({ email, password });

      // some implementations redirect after register
      expect([200, 201, 303]).toContain(reg.status);

      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .set(srv.headers)
        .send({ email, password });

      // eslint-disable-next-line no-console
      console.log('[profile login]', {
        status: login.status,
        setCookie: login.headers && login.headers['set-cookie']
          ? login.headers['set-cookie'][0]
          : null,
        body: login.body,
        text: login.text,
      });

      expect([200, 204, 302, 303]).toContain(login.status);

      const sidCookie = pickSidCookie(login.headers['set-cookie']);
      expect(sidCookie).toBeTruthy();

      const r = await request(srv.baseUrl)
        .get('/api/profile/downloads')
        .set(srv.headers)
        .set('Cookie', sidCookie);

      expect(r.status).toBe(200);
      expect(r.body).toBeTruthy();
    });
  });
});
