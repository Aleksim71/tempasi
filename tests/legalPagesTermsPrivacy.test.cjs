// path: tests/legalPagesTermsPrivacy.test.cjs
/* eslint-env node */
'use strict';

// /terms and /privacy: first drafts (pending legal review), previously
// dead footer links. Privacy must stay truthful to the code: no
// third-party font/CDN requests, one sid cookie, Stripe for payments.

const fs = require('node:fs');
const path = require('node:path');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

describe('Legal pages: /terms and /privacy', () => {
  let app;
  let request;

  beforeAll(async () => {
    const { createWebApp } = await import('../src/app.web.js');
    request = require('supertest');
    app = createWebApp({ db: null });
  });

  test('/terms renders as a marked draft with the withdrawal and liability sections', async () => {
    const res = await request(app).get('/terms');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Terms of Service');
    expect(res.text).toContain('Draft — pending legal review');
    expect(res.text).toContain('§ 356(5) BGB');
    expect(res.text).toContain('§ 36 VSBG');
    // ODR platform was shut down on 2025-07-20 — no link to it anymore
    expect(res.text).not.toContain('ec.europa.eu/odr');
  });

  test('/privacy renders as a marked draft and names the real processing', async () => {
    const res = await request(app).get('/privacy');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Privacy Policy');
    expect(res.text).toContain('Draft — pending legal review');
    expect(res.text).toContain('<code>sid</code>');
    expect(res.text).toContain('Stripe');
    expect(res.text).toContain('Hetzner');
    expect(res.text).toContain('BayLDA');
  });

  test('no Google Fonts / third-party font request anywhere in views or CSS', () => {
    const root = process.cwd();
    const files = [
      ...walk(path.join(root, 'public', 'css'), ['.css']),
      ...walk(path.join(root, 'src', 'web', 'views'), ['.hbs']),
    ];
    const offenders = files.filter((f) =>
      /fonts\.(googleapis|gstatic)\.com/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
