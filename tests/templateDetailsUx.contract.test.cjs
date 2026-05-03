// tests/templateDetailsUx.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('template details product page UX contract', () => {
  test('template details page separates product content from commercial actions', () => {
    const viewPath = path.join(ROOT, 'src/web/views/pages/template-details.hbs');
    const src = fs.readFileSync(viewPath, 'utf8');

    expect(src).toContain('template-details-shell');
    expect(src).toContain('template-details-main');
    expect(src).toContain('template-actions-sidebar');

    expect(src).toContain('Available:');
    expect(src).toContain('Category:');
    expect(src).toContain('Rating: coming soon');

    expect(src).toContain('About this template');
    expect(src).toContain('Details from the author');

    expect(src).toContain('Exclusive purchase');
    expect(src).toContain('Buy now');
    expect(src).toContain('Add to cart');

    expect(src).toContain('Client reservation');
    expect(src).toContain('name="rent_days"');
    expect(src).toContain('name="case_ids"');
    expect(src).toContain('Rent now');
    expect(src).toContain('Add rent to cart');

    expect(src).toContain('Demo');
    expect(src).toContain('Created by');
  });

  test('guest commercial actions redirect to login/register instead of guest cart', () => {
    const viewPath = path.join(ROOT, 'src/web/views/pages/template-details.hbs');
    const src = fs.readFileSync(viewPath, 'utf8');

    expect(src).toContain('{{#if isAuthenticated}}');
    expect(src).toContain('href="/login"');
    expect(src).toContain('template-rent-form-disabled');
    expect(src).toContain('id="guest_rent_days"');
    expect(src).toContain('Sign in to select one or more cases');
    expect(src).toContain('Sign in or create an account to buy, rent, or save templates to your cases.');
  });

  test('owner view keeps owner workflow separate from commercial buy and rent', () => {
    const viewPath = path.join(ROOT, 'src/web/views/pages/template-details.hbs');
    const src = fs.readFileSync(viewPath, 'utf8');

    expect(src).toContain('{{#if isOwner}}');
    expect(src).toContain('Owner actions');
    expect(src).toContain('Edit template');
    expect(src).toContain('Reserve for client');
    expect(src).toContain('Withdraw permanently');
    expect(src).toContain('Commercial buy and rent actions are disabled for your own templates.');
  });

  test('template details CSS supports two-column layout and sticky action sidebar', () => {
    const cssPath = path.join(ROOT, 'public/css/pages/template-details.css');
    const src = fs.readFileSync(cssPath, 'utf8');

    expect(src).toContain('grid-template-columns: minmax(0, 1fr) 380px');
    expect(src).toContain('position: sticky');
    expect(src).toContain('.template-buy-card');
    expect(src).toContain('.template-rent-card');
    expect(src).toContain('@media (max-width: 980px)');
  });
});
