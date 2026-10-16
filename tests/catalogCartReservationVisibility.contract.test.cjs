// tests/catalogCartReservationVisibility.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// TEMPASI_NO_CART_HOLD (2026-08-14): previously, simply adding an
// exclusive template to ANY user's cart hid it from the public
// catalog/details — with no expiry, meaning an abandoned cart could
// permanently lock a template out of sale. Product decision: cart-add
// is now free/non-blocking. Exclusivity is enforced only by an actual
// paid BUY, backed by a DB-level partial unique index
// (orders_unique_paid_buy_per_template) that makes a second
// concurrent paid BUY for the same template impossible — whoever
// loses that race gets a clear "already sold" message and the item is
// removed from their cart (see cart.checkout-pass.service.js /
// cart.routes.js). This test now guards the new behavior: the catalog
// and details queries must NOT reference cart_items for hiding
// purposes, so this doesn't silently regress back to the old
// permanent-hold behavior.
describe('catalog visibility does not hold templates just for sitting in a cart', () => {
  test('public catalog/details do not exclude templates based on cart_items', () => {
    const repoPath = path.join(ROOT, 'src/server/catalog/templates.repo.js');
    const src = fs.readFileSync(repoPath, 'utf8');

    expect(src).not.toContain('cart_items ci_public_cart_hold');
    expect(src).not.toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+cart_items/is);
  });
});
