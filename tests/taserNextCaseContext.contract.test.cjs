// tests/taserNextCaseContext.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('TASER-NEXT-A selected Case context contract', () => {
  test('catalog preserves ?caseId and passes it into template cards', () => {
    const route = read('src/web/routes/templates.routes.js');
    const index = read('src/web/views/pages/templates/index.hbs');
    const card = read('src/web/views/partials/template-card.v2.hbs');

    expect(route).toContain('normalizeCaseIdParam');
    expect(route).toContain('appendCaseContextToTemplates');
    expect(route).toContain('selectedCaseParam');
    expect(index).toContain('name="caseId"');
    expect(card).toContain('{{#if t.selectedCaseParam}}?{{t.selectedCaseParam}}{{/if}}');
  });

  test('template details preselects selected case and submits it to cart add', () => {
    const route = read('src/web/routes/templates.routes.js');
    const details = read('src/web/views/pages/template-details.hbs');

    expect(route).toContain('isSelected: selectedCaseId && String(item.id) === String(selectedCaseId)');
    expect(details).toContain('name="case_ids"');
    expect(details).toContain('{{#if this.isSelected}}checked{{/if}}');
    // NOTE (2026-08-03): the "Rent now" button (which had
    // next="/cart{{#if selectedCaseParam}}?{{selectedCaseParam}}{{/if}}")
    // was removed at the user's request — Buy/Rent now duplicated
    // "Add to cart"/"Add rent to cart" exactly (same /cart/add handler,
    // only differing in that redirect target) and risked an accidental
    // purchase-feeling click. Case context is still preserved in the
    // submission itself via the caseId hidden field below; only the
    // auto-navigate-to-/cart-with-context nicety went away with the
    // button that implemented it.
    expect(details).toContain('name="caseId" value="{{selectedCaseId}}"');
  });

  test('cart persists selected RENT case ids until checkout pass creates order assignment', () => {
    const cart = read('src/web/routes/cart.routes.js');
    const checkoutPass = read('src/web/services/cart.checkout-pass.service.js');
    const migration = read('src/db/migrations/20260506_0002_cart_items_case_context.sql');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS case_ids jsonb');
    expect(cart).toContain('collectCaseIds');
    expect(cart).toContain("hasColumn(db, 'cart_items', 'case_ids')");
    expect(cart).toContain('JSON.stringify(caseIds)');
    expect(checkoutPass).toContain('normalizeCaseIdsFromDb');
    expect(checkoutPass).toContain('orderCaseIdsColumn');
    expect(checkoutPass).toContain('INSERT INTO order_case_assignments(order_id, case_id)');
  });
});
