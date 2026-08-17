// tests/casesRentsTabRealPrice.contract.test.cjs
'use strict';

// TEMPASI_RENTS_TAB_REAL_PRICE (2026-08-17)
//
// Cabinet -> Cases -> Rents showed "Rent cost: €0.00 / 24h" for every
// active rent, and Analytics showed "Active rent cost: €0.00" — no
// matter what the template's actual rent price was.
//
// Root cause: normalizeCaseRentRow()'s priceRaw lookup checked
// row.active_rent_price_eur / daily_rent_price_eur / rent_price_eur /
// price_eur / rentPriceEur — none of which the SQL query (or anything
// else) ever populated, so it always fell through to the `|| 0`
// default. The real column is seller_templates.price_rent_cents
// (in cents), which the query never even selected. Separately,
// activeRentCostCents (feeding "Active rent cost" in Analytics) was
// declared but never incremented anywhere in the loop.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Cases Rents tab: real rent price instead of €0.00', () => {
  test('SQL query selects st.price_rent_cents', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');
    const queryBlock = src.match(/const rentsResult = await pool\.query\(\s*`[\s\S]*?`,/)[0];

    expect(queryBlock).toContain('st.price_rent_cents');
    expect(queryBlock).toContain('GROUP BY e.id, o.id, st.title, st.price_rent_cents');
  });

  test('activeRentCostCents is actually accumulated in the loop, not left at its initial 0', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(src).toContain('activeRentCostCents += Number(row.price_rent_cents || 0);');
  });

  test('normalizeCaseRentRow reads price_rent_cents (cents) via formatMoneyEurFromCents, not the old non-existent *_eur fields', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');
    const fnSrc = src.match(/function normalizeCaseRentRow\(row\) \{[\s\S]*?\n\}\n/)[0];

    expect(fnSrc).toContain('row.price_rent_cents ?? row.priceRentCents ?? 0');
    expect(fnSrc).toContain('dailyRentPriceEur: formatMoneyEurFromCents(dailyRentPriceCents)');
    expect(fnSrc).not.toContain('row.active_rent_price_eur');
    expect(fnSrc).not.toContain('row.daily_rent_price_eur');
  });

  test('real function call: price_rent_cents=200 (matches the €2.00/day template seen in testing) formats as 2.00', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');

    const formatMoneySrc = src.match(/function formatMoneyEurFromCents\(cents\) \{[\s\S]*?\n\}\n/)[0];
    const formatDateSrc = src.match(/function formatCaseRentDateTime\(value\) \{[\s\S]*?\n\}\n/)[0];
    const timeLeftStart = src.indexOf('function formatCaseRentTimeLeft');
    const normalizeStart = src.indexOf('function normalizeCaseRentRow');
    const timeLeftSrc = src.slice(timeLeftStart, normalizeStart);
    const normalizeSrc = src.match(/function normalizeCaseRentRow\(row\) \{[\s\S]*?\n\}\n/)[0];

    // eslint-disable-next-line no-eval
    const normalizeCaseRentRow = eval(`
      (function () {
        ${formatMoneySrc}
        ${formatDateSrc}
        ${timeLeftSrc}
        ${normalizeSrc}
        return normalizeCaseRentRow;
      })()
    `);

    const result = normalizeCaseRentRow({
      id: 1,
      order_id: 42,
      template_slug: 'lumen-frame',
      template_title: 'Lumen Frame',
      price_rent_cents: 200,
      ends_at: new Date(Date.now() + 24 * 3600 * 1000),
    });

    expect(result.dailyRentPriceEur).toBe('2.00');
    expect(result.priceEur).toBe(2);
  });
});
