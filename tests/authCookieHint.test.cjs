// path: tests/authCookieHint.test.cjs
/* eslint-env node */
'use strict';

// Login and register show a short, non-blocking notice about the single
// strictly necessary session cookie (no consent banner / cookie wall —
// § 25(2) TDDDG). The Cookies page states the real lifetimes from
// auth.pages.routes.js (2 h default, 30 days with "Remember me").

describe('Auth pages: session cookie notice', () => {
  let app;
  let request;

  beforeAll(async () => {
    const { createWebApp } = await import('../src/app.web.js');
    request = require('supertest');
    app = createWebApp({ db: null });
  });

  test.each(['/login', '/register'])(
    '%s shows the cookie notice with links to /cookies and /privacy',
    async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('class="auth-hint"');
      expect(res.text).toContain('strictly necessary session');
      expect(res.text).toContain('href="/cookies"');
      expect(res.text).toContain('href="/privacy"');
      // informational only — the page must not set any cookie on a plain GET
      expect(res.headers['set-cookie']).toBeUndefined();
    },
  );

  test('/cookies states the real session lifetimes', async () => {
    const res = await request(app).get('/cookies');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2 hours');
    expect(res.text).toContain('30 days');
    expect(res.text).toContain('Remember me');
  });
});
