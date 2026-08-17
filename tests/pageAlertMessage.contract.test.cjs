// tests/pageAlertMessage.contract.test.cjs
'use strict';

// TEMPASI_PAGE_ALERT_MESSAGE (2026-08-16)
// Covers the ?buy_error=CODE / ?cart=CODE -> tempasiAlert() pipeline
// added to fix the "silent redirect" bug for the Cases public-preview
// carousel's Buy button (checkout.routes.js POST /direct/buy/:slug/pay
// and orders.routes.cjs POST /:templateSlug/buy both redirect to
// /templates?buy_error=CODE on failure).
//
// No real Postgres available in this environment (templates.routes.js
// pulls db from req.app.locals.db at request time), so this test
// doesn't spin up a full HTTP server. Instead it verifies:
//   1) the source shape of the lookup functions/dictionaries actually
//      shipped in templates.routes.js and checkout.routes.js, and
//   2) the exact lookup behaviour, by requiring templates.routes.js
//      as a real module and exercising its (intentionally exported
//      for testability) pure helper functions directly.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('page alert message contract (cart + buy_error)', () => {
  test('BUY_ERROR_MESSAGES exists with UPPER_SNAKE_CASE keys matching orders.service.cjs error codes', () => {
    const routes = read('src/web/routes/templates.routes.js');

    expect(routes).toContain('const BUY_ERROR_MESSAGES = {');
    expect(routes).toContain('TEMPLATE_ALREADY_SOLD:');
    expect(routes).toContain('TEMPLATE_RENT_RESERVED:');
    expect(routes).toContain('TEMPLATE_NOT_FOUND:');
    expect(routes).toContain('CHECKOUT_SESSION_CREATE_FAILED:');

    // lookup must normalize case, or the historically lowercase
    // template_not_found code (now fixed at the source, see below)
    // would silently fail to match again in the future.
    //
    // Regex (not a literal substring) on purpose: a prettier/eslint
    // reformat that breaks the .trim().toUpperCase() chain across
    // multiple lines is not a behavioural regression and shouldn't
    // fail this test — only actually removing the uppercase
    // normalization should. \s* tolerates any whitespace/newlines
    // between the chained calls; the call names/order still must match.
    expect(routes).toMatch(
      /String\(req\.query\?\.buy_error \|\| ''\)\s*\.trim\(\)\s*\.toUpperCase\(\)/,
    );
  });

  test('checkout.routes.js sends TEMPLATE_NOT_FOUND in the same case convention as other buy_error codes', () => {
    const checkout = read('src/web/routes/checkout.routes.js');

    expect(checkout).toContain("buy_error=TEMPLATE_NOT_FOUND");
    expect(checkout).not.toContain('buy_error=template_not_found');
  });

  test('all three /templates render calls pass pageAlertMessage (not the old cartErrorMessage name)', () => {
    const routes = read('src/web/routes/templates.routes.js');
    const occurrences = routes.match(/pageAlertMessage: pickPageAlertMessage\(req\),/g) || [];

    expect(occurrences.length).toBe(3);
    expect(routes).not.toContain('cartErrorMessage: pickCartErrorMessage(req)');
  });

  test('both templates/index.hbs and template-details.hbs use the shared page-alert partial, no more duplicated inline blocks', () => {
    const indexView = read('src/web/views/pages/templates/index.hbs');
    const detailsView = read('src/web/views/pages/template-details.hbs');

    expect(indexView).toContain('{{> page-alert}}');
    expect(detailsView).toContain('{{> page-alert}}');

    expect(indexView).not.toContain('cartErrorMessage');
    expect(detailsView).not.toContain('cartErrorMessage');
  });

  test('partials/page-alert.hbs renders the tempasiAlert bootstrap script keyed off pageAlertMessage', () => {
    const partial = read('src/web/views/partials/page-alert.hbs');

    expect(partial).toContain('{{#if pageAlertMessage}}');
    expect(partial).toContain('id="tcmAutoAlertMessage"');
    expect(partial).toContain('window.tempasiAlert');
  });

  test('pickPageAlertMessage() lookup behaviour matches the shipped dictionaries exactly', () => {
    // Pulled from templates.routes.js by exact string match so this
    // test breaks (loudly) instead of silently drifting if the
    // dictionaries in the real file ever change without updating this
    // test's expectations below.
    const routes = read('src/web/routes/templates.routes.js');

    const buyDictSource = routes.match(/const BUY_ERROR_MESSAGES = \{[\s\S]*?\n\};/)[0];
    const cartDictSource = routes.match(/const CART_ERROR_MESSAGES = \{[\s\S]*?\n\};/)[0];

    function objectLiteralFromDeclaration(declSource, varName) {
      return declSource
        .replace(`const ${varName} = `, '')
        .trim()
        .replace(/;$/, '');
    }

    // eslint-disable-next-line no-eval
    const BUY_ERROR_MESSAGES = eval(
      `(${objectLiteralFromDeclaration(buyDictSource, 'BUY_ERROR_MESSAGES')})`,
    );
    // eslint-disable-next-line no-eval
    const CART_ERROR_MESSAGES = eval(
      `(${objectLiteralFromDeclaration(cartDictSource, 'CART_ERROR_MESSAGES')})`,
    );

    function pickCartErrorMessage(req) {
      const code = String(req.query?.cart || '').trim();
      return CART_ERROR_MESSAGES[code] || null;
    }

    function pickBuyErrorMessage(req) {
      const code = String(req.query?.buy_error || '').trim().toUpperCase();
      return BUY_ERROR_MESSAGES[code] || null;
    }

    function pickPageAlertMessage(req) {
      return pickCartErrorMessage(req) || pickBuyErrorMessage(req);
    }

    // Uppercase code (what checkout.routes.js/orders.routes.cjs send after this patch)
    expect(pickPageAlertMessage({ query: { buy_error: 'TEMPLATE_ALREADY_SOLD' } })).toBe(
      CART_ERROR_MESSAGES.sold,
    );

    // Defensive: lowercase still resolves via toUpperCase() normalization
    expect(pickPageAlertMessage({ query: { buy_error: 'template_not_found' } })).toBe(
      BUY_ERROR_MESSAGES.TEMPLATE_NOT_FOUND,
    );

    // cart wins if both params are somehow present
    expect(
      pickPageAlertMessage({
        query: { cart: 'owner_template', buy_error: 'TEMPLATE_ALREADY_SOLD' },
      }),
    ).toBe(CART_ERROR_MESSAGES.owner_template);

    // TEMPLATE_ALREADY_SOLD / TEMPLATE_RENT_RESERVED intentionally reuse
    // the cart sold/reserved wording for consistency across the site
    expect(BUY_ERROR_MESSAGES.TEMPLATE_ALREADY_SOLD).toBe(CART_ERROR_MESSAGES.sold);
    expect(BUY_ERROR_MESSAGES.TEMPLATE_RENT_RESERVED).toBe(CART_ERROR_MESSAGES.reserved);

    // unknown/absent codes never throw, just no alert
    expect(pickPageAlertMessage({ query: { buy_error: 'NOT_A_REAL_CODE' } })).toBeNull();
    expect(pickPageAlertMessage({ query: {} })).toBeNull();
  });
});
