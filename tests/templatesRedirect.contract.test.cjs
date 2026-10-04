// tests/templatesRedirect.contract.test.cjs
'use strict';

// TEMPASI_TEMPLATES_ORIGIN_REDIRECT (2026-10-04)
// Reverses TEMPASI_PREVIEW_PROXY_RESTORED: /t/* is no longer proxied
// onto the app origin; it is redirected to the separate templates
// origin (see src/web/routes/templates-redirect.routes.js).

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const ROOT = path.resolve(__dirname, '..');

async function loadRouterModule() {
  return import('../src/web/routes/templates-redirect.routes.js');
}

async function buildApp(origin) {
  const { createTemplatesRedirectRouter } = await loadRouterModule();
  const app = express();
  app.use(createTemplatesRedirectRouter({ origin }));
  app.use((req, res) => res.status(404).send('fallthrough'));
  return app;
}

describe('templates origin redirect (/t/*)', () => {
  test('redirects /t/* to PREVIEW_ORIGIN with path and query preserved', async () => {
    const app = await buildApp('https://templates.example.test');

    const res = await request(app).get('/t/seed-001/src/index.html?x=1&y=2').expect(302);
    expect(res.headers.location).toBe('https://templates.example.test/t/seed-001/src/index.html?x=1&y=2');

    const png = await request(app).get('/t/seed-001/preview/preview.png').expect(302);
    expect(png.headers.location).toBe('https://templates.example.test/t/seed-001/preview/preview.png');
  });

  test('HEAD is redirected too; other methods and other paths fall through', async () => {
    const app = await buildApp('https://templates.example.test');

    await request(app).head('/t/seed-001/preview.png').expect(302);
    await request(app).post('/t/seed-001/preview.png').expect(404);
    await request(app).get('/templates').expect(404);
    await request(app).get('/tx/seed-001').expect(404);
  });

  test('origin only: path/trailing slash in the env value is ignored', async () => {
    const app = await buildApp('https://templates.example.test/some/path/');
    const res = await request(app).get('/t/a/b.css').expect(302);
    expect(res.headers.location).toBe('https://templates.example.test/t/a/b.css');
  });

  test('unset/empty PREVIEW_ORIGIN: no redirect, request falls through to local /t routes', async () => {
    for (const origin of [undefined, '', '   ']) {
      const app = await buildApp(origin);
      const res = await request(app).get('/t/seed-001/preview/preview.png').expect(404);
      expect(res.text).toBe('fallthrough');
    }
  });

  test('invalid PREVIEW_ORIGIN fails fast at boot', async () => {
    const { resolveTemplatesOrigin } = await loadRouterModule();
    expect(() => resolveTemplatesOrigin('not a url')).toThrow(/PREVIEW_ORIGIN_INVALID/);
    expect(() => resolveTemplatesOrigin('ftp://x.test')).toThrow(/PREVIEW_ORIGIN_INVALID/);
  });

  test('app.js mounts the redirect router and no longer the preview proxy', () => {
    const appJs = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
    expect(appJs).toMatch(/createTemplatesRedirectRouter\(\)/);
    expect(appJs).not.toMatch(/createPreviewProxyRouter/);
    expect(fs.existsSync(path.join(ROOT, 'src/web/routes/preview-proxy.routes.js'))).toBe(false);
  });
});
