// path: tests/headerInfoLink.test.cjs
/* eslint-env node */
'use strict';

// Header "Info" link: visible to everyone, leads to /about, active on
// every info-section page (flag: infoNav), last item in the main nav.

const fs = require('node:fs');
const path = require('node:path');

const INFO_LINK = /<a href="\/about" class="nav-link( nav-link--active)?">Info<\/a>/;

describe('Header: Info link', () => {
  let app;
  let request;

  beforeAll(async () => {
    const { createWebApp } = await import('../src/app.web.js');
    request = require('supertest');
    app = createWebApp({ db: null });
  });

  test.each(['/about', '/terms', '/faq', '/offers'])(
    'is shown and active on info page %s',
    async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      const m = res.text.match(INFO_LINK);
      expect(m).not.toBeNull();
      expect(m[1]).toBe(' nav-link--active');
    },
  );

  test('is shown to anonymous visitors but not active outside the info section', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    const m = res.text.match(INFO_LINK);
    expect(m).not.toBeNull();
    expect(m[1]).toBeUndefined();
  });

  test('is the last item of the main nav, outside the isAuthed block', () => {
    const tpl = fs.readFileSync(
      path.join(process.cwd(), 'src/web/views/partials/site-header.hbs'),
      'utf8',
    );
    const nav = tpl.slice(tpl.indexOf('<nav class="site-header__nav"'), tpl.indexOf('</nav>'));
    const lastLink = nav.lastIndexOf('<a href=');
    expect(nav.slice(lastLink)).toContain('>Info</a>');
    expect(nav.indexOf('{{/if}}', nav.indexOf('{{#if isAuthed}}'))).toBeLessThan(lastLink);
  });
});
