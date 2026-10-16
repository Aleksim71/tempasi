// path: tests/supportContentRework.test.cjs
/* eslint-env node */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Static content pages: /about and /functionality', () => {
  test('both routes render 200 with real content via the actual web app layout', async () => {
    const { createWebApp } = await import('../src/app.web.js');
    const request = require('supertest');
    const app = createWebApp({ db: null });

    const about = await request(app).get('/about');
    expect(about.status).toBe(200);
    expect(about.text).toContain('About Tempasi');
    expect(about.text).toContain('/css/pages/static-content.css');
    // rendered through the real layout: header + footer should be present
    expect(about.text).toMatch(/TEMPASI/);
    expect(about.text).toContain('Terms');

    const functionality = await request(app).get('/functionality');
    expect(functionality.status).toBe(200);
    expect(functionality.text).toContain('How Tempasi works');

    const impressum = await request(app).get('/impressum');
    expect(impressum.status).toBe(200);
    expect(impressum.text).toContain('Impressum');
    expect(impressum.text).toContain('§ 5 DDG');

    const license = await request(app).get('/license');
    expect(license.status).toBe(200);
    expect(license.text).toContain('Template License');
    expect(license.text).toContain('No reusing the same purchase across multiple unrelated websites');

    const contact = await request(app).get('/contact');
    expect(contact.status).toBe(200);
    expect(contact.text).toContain('support@tempasi.com');
    // Fabricated inboxes from the old orphaned contact.hbs must not resurface.
    expect(contact.text).not.toContain('partners@tempasi.com');
    expect(contact.text).not.toContain('legal@tempasi.com');
  });

  test('/landing renders 200 with both CTAs, no main site header, and is now linked from the footer', async () => {
    const { createWebApp } = await import('../src/app.web.js');
    const request = require('supertest');
    const app = createWebApp({ db: null });

    const res = await request(app).get('/landing');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/css/pages/landing.css');
    expect(res.text).toContain('href="#studios"');
    expect(res.text).toContain('href="#designers"');
    expect(res.text).toContain('href="/templates"');
    expect(res.text).toContain('href="/register"');
    // Decision reversed on 2026-08-28: /landing is now deliberately
    // linked from the footer (Product -> "Who benefits from this?"),
    // alongside FAQ. Header stays hidden on the landing page itself
    // regardless of referral source.
    expect(res.text).not.toMatch(/site-header__nav/);
    const footer = readProjectFile('src/web/views/partials/footer.hbs');
    expect(footer).toContain('/landing');
  });

  test('/cookies documents only the real sid session cookie, no fabricated analytics claims', async () => {
    const { createWebApp } = await import('../src/app.web.js');
    const request = require('supertest');
    const app = createWebApp({ db: null });

    const res = await request(app).get('/cookies');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Cookie Policy');
    expect(res.text).toContain('sid');
    expect(res.text).toContain('HttpOnly');
    expect(res.text).not.toMatch(/googletagmanager\.com|gtag\(|fbq\(/i);
  });

  test('/faq is public (no auth), has all 5 questions, and the refund answer no longer flatly says "no refunds"', async () => {
    const { createWebApp } = await import('../src/app.web.js');
    const request = require('supertest');
    const app = createWebApp({ db: null });

    const res = await request(app).get('/faq');
    expect(res.status).toBe(200);
    const questionCount = (res.text.match(/<summary>/g) || []).length;
    expect(questionCount).toBe(5);
    expect(res.text).toContain('Buy and Rent');
    expect(res.text).toContain('href="/license"');
    // Aligned with the checkout withdrawal-waiver consent: refunds
    // aren't flatly refused anymore, the waiver is explained instead.
    expect(res.text).not.toContain("so we don't offer refunds");
  });

  test('/about does not link into the auth-gated cabinet (anonymous visitors would just get redirected)', () => {
    const view = readProjectFile('src/web/views/pages/static/about.hbs');
    expect(view).not.toMatch(/href="\/cabinet\/support\?tab=/);
    expect(view).toContain('mailto:support@tempasi.com');
  });
});

describe('Cabinet Support tab rework', () => {
  test('cabinet routes accept ?tab=faq and no longer use the old "quick" key', () => {
    const routes = readProjectFile('src/web/routes/cabinet.pages.routes.cjs');
    const supportSection = routes.slice(routes.indexOf("router.get('/support'"));

    expect(supportSection).toMatch(/allowedTabs\s*=\s*new Set\(\['help', 'contact', 'faq'\]\)/);
    expect(supportSection.slice(0, 800)).not.toMatch(/'quick'/);
  });

  test('/cabinet/support requires auth (redirects anonymous requests to /login)', async () => {
    const express = require('express');
    const request = require('supertest');
    const { createCabinetPagesRouter } = require('../src/web/routes/cabinet.pages.routes.cjs');

    const app = express();
    app.use('/cabinet', createCabinetPagesRouter());

    const res = await request(app).get('/cabinet/support?tab=faq');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('Help tab links to /about and /functionality, not the old generic "Browse Templates" button', () => {
    const view = readProjectFile('src/web/views/partials/space-support.hbs');

    expect(view).toContain('href="/about"');
    expect(view).toContain('href="/functionality"');
    expect(view).not.toContain('Browse Templates');
    expect(view).not.toContain('Help Center');
  });

  test('FAQ tab replaces the old "Quick Help" shortcut buttons and links out to the public /faq', () => {
    const view = readProjectFile('src/web/views/partials/space-support.hbs');
    const faqSection = view.slice(view.indexOf('tab "faq"'));

    expect(view).not.toContain('Quick Help');
    expect(faqSection).toMatch(/href="\/faq"/);
  });

  test('rendered FAQ tab links to the public /faq page instead of duplicating the content', () => {
    const hbs = require('hbs');
    hbs.registerHelper('eq', (a, b) => a === b);

    const tpl = readProjectFile('src/web/views/partials/space-support.hbs');
    const compiled = hbs.handlebars.compile(tpl);

    const html = compiled({
      workspaceData: {
        support: {
          tab: 'faq',
          tabs: [
            { key: 'help', label: 'Help', href: '#', isActive: false },
            { key: 'contact', label: 'Contact', href: '#', isActive: false },
            { key: 'faq', label: 'FAQ', href: '#', isActive: true },
          ],
        },
      },
    });

    expect(html).toContain('href="/faq"');
    // The old inline accordion is gone from this tab -- /faq is now the
    // single source of truth for FAQ content.
    expect(html).not.toContain('<details>');
  });
});
