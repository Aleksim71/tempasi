// path: tests/infoPagesSection.test.cjs
/* eslint-env node */
'use strict';

// Info section (footer pages): cabinet-style sidebar driven by
// src/web/info-pages.js, page text on the right. /offers = landing
// content inside the section.

const INFO_PATHS = [
  '/about',
  '/functionality',
  '/offers',
  '/impressum',
  '/terms',
  '/privacy',
  '/license',
  '/cookies',
  '/faq',
  '/contact',
];

describe('Info section: sidebar layout for footer pages', () => {
  let app;
  let request;

  beforeAll(async () => {
    const { createWebApp } = await import('../src/app.web.js');
    request = require('supertest');
    app = createWebApp({ db: null });
  });

  test.each(INFO_PATHS)(
    '%s renders inside the info layout with itself active in the sidebar',
    async (p) => {
      const res = await request(app).get(p);
      expect(res.status).toBe(200);
      expect(res.text).toContain('class="info__layout"');
      expect(res.text).toContain('/css/pages/info.css');
      expect(res.text).toMatch(/site-header/);

      // every info page is listed in the sidebar
      for (const other of INFO_PATHS) {
        expect(res.text).toContain(`href="${other}"`);
      }

      // exactly one active entry, and it is this page
      const active = res.text.match(/class="side__link is-active" href="([^"]+)"/g) || [];
      expect(active).toHaveLength(1);
      expect(active[0]).toContain(`href="${p}"`);
    },
  );

  test('sidebar groups: About / Legal / Support', async () => {
    const res = await request(app).get('/about');
    const titles = [...res.text.matchAll(/<div class="side__title">([^<]+)<\/div>/g)].map(
      (m) => m[1],
    );
    expect(titles).toEqual(['About', 'Legal', 'Support']);
  });

  test('/offers shows the landing content with the site header, /landing keeps it header-less', async () => {
    const offers = await request(app).get('/offers');
    expect(offers.status).toBe(200);
    expect(offers.text).toContain('class="info-offers"');
    expect(offers.text).toContain('id="studios"');
    expect(offers.text).toContain('id="designers"');
    expect(offers.text).toContain('/css/pages/landing.css');
    expect(offers.text).toMatch(/site-header__nav/);

    const landing = await request(app).get('/landing');
    expect(landing.status).toBe(200);
    expect(landing.text).toContain('id="studios"');
    expect(landing.text).not.toMatch(/site-header__nav/);
    expect(landing.text).not.toContain('info__layout');
  });
});
