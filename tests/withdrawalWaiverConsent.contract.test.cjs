// path: tests/withdrawalWaiverConsent.contract.test.cjs
/* eslint-env node */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('EU digital-content withdrawal-waiver consent (checkout)', () => {
  test('direct-buy review template renders a required consent checkbox, hidden only when purchase is blocked', () => {
    const view = readProjectFile('src/web/views/pages/checkout-direct-buy-review.hbs');
    expect(view).toContain('name="withdrawal_waiver_ack"');
    expect(view).toContain('required');
    // The pay form (and its checkbox) must still render when the only
    // issue is a missing checkbox — only truly blocking errors (e.g.
    // buying your own template) should hide the form entirely.
    expect(view).toContain('{{#unless blockPurchase}}');
    expect(view).not.toContain('{{#unless error}}');
  });

  test('checkout.routes.js enforces the waiver server-side and distinguishes blocking vs retryable errors', () => {
    const source = readProjectFile('src/web/routes/checkout.routes.js');
    expect(source).toContain("req.body?.withdrawal_waiver_ack");
    expect(source).toContain('blockPurchase: true');
    // The "cannot buy own template" case is unrecoverable and sets
    // blockPurchase; the consent-missing case must not.
    const ownTemplateIdx = source.indexOf('You cannot buy your own template.');
    const consentIdx = source.indexOf('Please confirm you understand this purchase completes immediately');
    expect(ownTemplateIdx).toBeGreaterThan(-1);
    expect(consentIdx).toBeGreaterThan(-1);
    const blockPurchaseNearOwnTemplate = source
      .slice(ownTemplateIdx, ownTemplateIdx + 200)
      .includes('blockPurchase: true');
    const blockPurchaseNearConsent = source
      .slice(consentIdx, consentIdx + 200)
      .includes('blockPurchase: true');
    expect(blockPurchaseNearOwnTemplate).toBe(true);
    expect(blockPurchaseNearConsent).toBe(false);
  });

  test('cart.hbs renders a required consent checkbox on the real Checkout form (not the dev-only Demo Checkout)', () => {
    const view = readProjectFile('src/web/views/pages/cart.hbs');
    const checkoutFormIdx = view.indexOf('id="cartCheckoutAllForm"');
    const demoFormIdx = view.indexOf('/cart/demo-checkout');
    expect(checkoutFormIdx).toBeGreaterThan(-1);
    expect(demoFormIdx).toBeGreaterThan(-1);

    const checkoutFormSlice = view.slice(checkoutFormIdx, demoFormIdx);
    expect(checkoutFormSlice).toContain('name="withdrawal_waiver_ack"');
    expect(checkoutFormSlice).toContain('required');
  });

  test('cart.routes.js checkout-all rejects submissions without the waiver before touching the DB', () => {
    const source = readProjectFile('src/web/routes/cart.routes.js');
    const consentIdx = source.indexOf('withdrawal_waiver_ack');
    const dbCheckIdx = source.indexOf('DB_NOT_CONFIGURED', consentIdx);
    expect(consentIdx).toBeGreaterThan(-1);
    expect(dbCheckIdx).toBeGreaterThan(consentIdx);
    expect(source).toContain("/cart?error=consent_required");
  });

  test('pickNotice() surfaces a real message for the consent_required error code', () => {
    const source = readProjectFile('src/web/routes/cart.routes.js');
    expect(source).toContain("=== 'consent_required'");
  });
});
