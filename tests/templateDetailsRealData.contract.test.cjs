// tests/templateDetailsRealData.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('template details real data contract', () => {
  test('catalog repo exposes real template metadata fields', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/server/catalog/templates.repo.js'), 'utf8');

    expect(src).toContain('description,');
    expect(src).toContain('preview_image,');
    expect(src).toContain('preview_url,');
    expect(src).toContain('demo_url,');
    expect(src).toContain('category,');
    expect(src).toContain('fullDescription: toStr(r.description');
    expect(src).toContain('demoUrl: toStr(r.demo_url');
  });

  test('template details route loads authenticated user cases by text user_id', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/web/routes/templates.routes.js'), 'utf8');

    expect(src).toContain('loadUserCasesForTemplateDetails');
    expect(src).toContain('FROM cases');
    expect(src).toContain('WHERE user_id = $1');
    expect(src).toContain('[String(userId)]');
    expect(src).toContain('cases: templateDetailsCases || []');
  });

  test('template details view uses real seller nickname and guest rent preview', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/web/views/pages/template-details.hbs'), 'utf8');

    expect(src).toContain('sellerProfile.nickname');
    expect(src).toContain('template.fullDescription');
    expect(src).toContain('template.category');
    expect(src).toContain('template-rent-form-disabled');
    expect(src).toContain('Sign in to select one or more cases');
  });

  test('migration adds real template category metadata', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'sql/migrations/20260503_0001_seller_templates_category.sql'),
      'utf8',
    );

    expect(src).toContain('ADD COLUMN IF NOT EXISTS category');
    expect(src).toContain("WHEN 'seed-008' THEN 'Education'");
  });
});
