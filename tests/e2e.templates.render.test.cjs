'use strict';

// tests/e2e.templates.render.test.cjs
// E2E smoke: /templates renders HTML and does not contain common regressions
// (missing partials, broken css link to /css/components.css).

const request = require('supertest');
const { withRealServer } = require('./helpers/realServer.cjs');

describe('E2E: /templates render smoke (via real server)', () => {
  test('GET /templates -> 200 and HTML; no "partial ... could not be found"; no /css/components.css', async () => {
    await withRealServer(async (srv) => {
      const res = await request(srv.baseUrl).get('/templates');

      // Status
      expect(res.status).toBe(200);

      // Content-Type should be HTML
      const ct = String(res.headers['content-type'] || '');
      expect(ct).toContain('text/html');

      const html = String(res.text || '');

      // Common handlebars runtime error when partial is missing
      expect(html).not.toMatch(/The partial .* could not be found/i);
      expect(html).not.toMatch(/Error:\s.*partial .* could not be found/i);

      // If someone accidentally re-adds the legacy/broken global css bundle link
      expect(html).not.toContain('href="/css/components.css"');
      expect(html).not.toContain("href='/css/components.css'");
    });
  });
});
