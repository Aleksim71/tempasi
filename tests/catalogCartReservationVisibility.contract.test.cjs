// tests/catalogCartReservationVisibility.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('catalog visibility respects cart reservations', () => {
  test('public catalog/details exclude templates reserved in cart', () => {
    const repoPath = path.join(ROOT, 'src/server/catalog/templates.repo.js');
    const src = fs.readFileSync(repoPath, 'utf8');

    expect(src).toContain('cart_items ci_public_cart_hold');
    expect(src).toContain('ci_public_cart_hold.template_id');
    expect(src).toContain("ci_public_cart_hold.license = 'BUY'");
    expect(src).toContain("ci_public_cart_hold.license = 'RENT'");
    expect(src).toContain("ci_public_cart_hold.license = 'PU'");
    expect(src).toContain("ci_public_cart_hold.license ~ '^PU:[1-9][0-9]*d$'");
    expect(src).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+cart_items/is);
  });
});
