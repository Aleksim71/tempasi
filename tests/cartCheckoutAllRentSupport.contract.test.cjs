// tests/cartCheckoutAllRentSupport.contract.test.cjs
'use strict';

// TEMPASI_CANONICAL_ORDER_CASE_ASSIGNMENT / TEMPASI_CHECKOUT_ALL_RENT_SUPPORT (2026-08-16)
//
// Root cause chain that led here: renting a template into a Case never
// showed up, even after a real "Payment successful" completion. Traced
// through three implementations of cart checkout:
//   - checkoutAllCartItems (the real "Checkout" button, cart.routes.js)
//     used to filter out every non-BUY item entirely ("RENT items are
//     not yet supported by bulk checkout").
//   - checkoutCartPass (cart.checkout-pass.service.js) does create
//     order_case_assignments, but at checkout-SESSION-creation time
//     (before payment), is limited to one item per call, was never
//     wired to any button in cart.hbs, and has no HTTP-level test.
//   - demoCompleteCartCheckout (the "legacy, no confirmation" button)
//     is the only path that fully worked, but it reimplements payment
//     completion from scratch (no payment-provider abstraction, no
//     app-level BUY-exclusivity check) — a dead end for adapting to a
//     real payment provider later.
//
// The actual fix has two parts:
//   1) paymentCompletion.service.cjs's completePaidOrder() — the ONE
//      canonical completion point every RENT order should eventually
//      funnel through (single-item flow today, a real payment webhook
//      tomorrow) — now creates order_case_assignments itself, reading
//      order.case_ids. This fixes every current AND future caller at
//      once, instead of a fourth reimplementation.
//   2) checkoutAllCartItems no longer filters out RENT — it builds the
//      same rentDays/caseIds payload createOrderCheckout() already
//      validates for the single-item flow.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('cart checkout-all: RENT support via the canonical pipeline', () => {
  test('paymentCompletion.service.cjs creates order_case_assignments for paid RENT orders', () => {
    const src = read('src/modules/payments/paymentCompletion.service.cjs');

    expect(src).toContain('async function assignPaidRentOrderToCases(paidOrder)');
    expect(src).toContain("String(paidOrder.deal_type || '').toUpperCase() !== 'RENT'");
    expect(src).toContain('INSERT INTO public.order_case_assignments(order_id, case_id)');
    // BUY orders (and RENT orders without a table) must not crash completion
    expect(src).toContain("e.code === '42P01'");
    // exposed on the return value so callers (and this test's HTTP-level
    // sibling checks) can assert on it directly
    expect(src).toContain('assignedCaseIds');
  });

  test('cart.routes.js: checkoutAllCartItems no longer filters out RENT items', () => {
    const src = read('src/web/routes/cart.routes.js');

    expect(src).not.toContain("String(item.deal_type || '').toUpperCase() !== 'BUY'");
    expect(src).toContain("dealType !== 'BUY' && dealType !== 'RENT'");
    expect(src).toContain('ci.case_ids');
  });

  test('cart.routes.js: RENT payload sent to createOrderCheckout includes rentDays and caseIds', () => {
    const src = read('src/web/routes/cart.routes.js');

    expect(src).toContain('const rentDays = dealType === \'RENT\' ? parseRentDaysFromLicense(item.license) : null;');
    expect(src).toContain('const caseIds = dealType === \'RENT\' ? normalizeCaseIdsFromCart(item.case_ids) : [];');
    expect(src).toContain('rentDays,');
    expect(src).toContain('caseIds,');
  });

  test('cart.hbs: hint text no longer claims RENT is unsupported by bulk checkout, and demo-checkout is relabeled', () => {
    const view = read('src/web/views/pages/cart.hbs');

    expect(view).not.toContain('RENT items are not yet supported by bulk checkout');
    expect(view).toContain('Demo Checkout (legacy, no confirmation)');
    expect(view).toContain('BUY and RENT alike');
  });
});
