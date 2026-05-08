// tests/taserNextCasePreviewRender.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('TASER-NEXT-B case preview render contract', () => {
  test('cases have a tokenized public preview URL without exposing internal preview to anonymous users', () => {
    const migration = read('src/db/migrations/20260506_0003_cases_public_preview_token.sql');
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');
    const partial = read('src/web/views/partials/space-cases.hbs');

    expect(migration).toContain('public_preview_token');
    expect(migration).toContain('gen_random_uuid()');
    expect(routes).toContain("router.get('/cases/:id/preview/public'");
    expect(routes.indexOf("router.get('/cases/:id/preview/public'")).toBeLessThan(routes.indexOf('router.use(requireAuthPage)'));
    expect(partial).toContain('Client preview');
    expect(partial).toContain('Client preview');
  });

  test('case repository returns real template card data for assigned active RENT templates', () => {
    const repo = read('src/modules/cases/cases.repo.cjs');

    expect(repo).toContain('st.preview_url');
    expect(repo).toContain('st.preview_image');
    expect(repo).toContain('st.demo_url');
    expect(repo).toContain('st.price_buy_cents');
    expect(repo).toContain('st.price_rent_cents');
    expect(repo).toContain('listPublicPreviewTemplates');
    expect(repo).toContain('LOWER(COALESCE(o.status');
    expect(repo).toContain("= 'paid'");
    expect(repo).toContain('e.closed_at IS NULL');
    expect(repo).toContain('e.ends_at > NOW()');
  });

  test('case view and public preview render rich template cards with preview, prices, tags and live demo links', () => {
    const routes = read('src/web/routes/cabinet.pages.routes.cjs');
    const partial = read('src/web/views/partials/space-cases.hbs');
    const publicPage = read('src/web/views/pages/case-preview-public.hbs');

    expect(routes).toContain('resolveCaseTemplatePreviewUrl');
    expect(routes).toContain('priceLabel');
    expect(routes).toContain('tagItems');
    expect(routes).toContain('liveDemoUrl');

    expect(partial).toContain('{{priceLabel}}');
    expect(partial).toContain('{{#each tagItems}}');
    expect(partial).toContain('cases-template-preview--large');

    expect(publicPage).toContain('Tempasi client preview');
    expect(publicPage).toContain('{{previewUrl}}');
    expect(publicPage).toContain('{{priceLabel}}');
    expect(publicPage).toContain('{{liveDemoUrl}}');
    expect(publicPage).not.toContain('Exclude</button>');
    expect(publicPage).not.toContain('Copy to case</button>');
  });
});
