// tests/casesMarketAnalytics.contract.test.cjs
'use strict';

// TEMPASI_CASES_MARKET_ANALYTICS (2026-08-17)
//
// Cabinet -> Cases -> Analytics restructured on request: removed the
// redundant "Analytics" heading (duplicates the tab label) and the
// two placeholder sentences, added two sections mirroring My
// Templates -> Analytics -> Overview's "My templates" / "Market"
// pattern — "My cases" and "Market cases", each showing:
//   - avg. templates per non-empty case (BUY + RENT assignments both
//     count, not just RENT)
//   - avg. rent cost per case (sum of daily rent price across a
//     case's RENT-assigned templates, averaged across non-empty cases)
//
// "My cases" is scoped via the case IDs the route already loaded
// through casesService.getOwnerCases() (avoids re-deriving the
// cases table's owner column, which varies — owner_user_id vs
// user_id, see cases.repo.cjs#getCasesSchema).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Cases Analytics: My cases / Market cases breakdown', () => {
  test('space-cases.hbs: redundant "Analytics" heading, placeholder texts, and the old flat KPI row (Active cases/Held templates/Active rent cost) are gone', () => {
    const src = read('src/web/views/partials/space-cases.hbs');
    const analyticsBlock = src.match(
      /\{\{!-- ANALYTICS --\}\}[\s\S]*?\{\{\/if\}\}\n<\/section>/,
    )[0];

    expect(analyticsBlock).not.toContain('>Analytics<');
    expect(analyticsBlock).not.toContain('Current state and later');
    expect(analyticsBlock).not.toContain('Deeper analytics for periods');
    expect(analyticsBlock).not.toContain('>Active cases<');
    expect(analyticsBlock).not.toContain('>Held templates<');
    expect(analyticsBlock).not.toContain('>Active rent cost<');
  });

  test('space-cases.hbs: has "My cases" and "Market cases" sections with both metrics each', () => {
    const src = read('src/web/views/partials/space-cases.hbs');
    const analyticsBlock = src.match(
      /\{\{!-- ANALYTICS --\}\}[\s\S]*?\{\{\/if\}\}\n<\/section>/,
    )[0];

    expect(analyticsBlock).toContain('>My cases<');
    expect(analyticsBlock).toContain('>Market cases<');
    expect(analyticsBlock).toContain('{{workspaceData.cases.analytics.myCases.avgTemplates}}');
    expect(analyticsBlock).toContain('{{workspaceData.cases.analytics.myCases.avgRentCostEur}}');
    expect(analyticsBlock).toContain('{{workspaceData.cases.analytics.marketCases.avgTemplates}}');
    expect(analyticsBlock).toContain('{{workspaceData.cases.analytics.marketCases.avgRentCostEur}}');
  });

  test('cabinet.pages.routes.cjs: computeCaseMarketMetrics counts only RENT toward non-empty (not BUY)', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');
    const fnSrc = src.match(/async function computeCaseMarketMetrics\(pool, myCaseIds\) \{[\s\S]*?\n\}\n/)[0];

    expect(fnSrc).toContain("UPPER(COALESCE(o.deal_type, '')) = 'RENT'");
    expect(fnSrc).not.toContain("UPPER(COALESCE(o.deal_type, '')) = 'BUY'");
    expect(fnSrc).toContain('e.closed_at IS NULL');
    expect(fnSrc).toContain('e.ends_at IS NULL OR e.ends_at > NOW()');
  });

  test('cabinet.pages.routes.cjs: "my cases" scoping uses already-loaded case IDs, not a re-derived owner column', () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');

    expect(src).toContain('const caseMarketMetrics = await computeCaseMarketMetrics(');
    expect(src).toContain('caseItems.map((item) => item.id),');
    expect(src).toContain('myCases: caseMarketMetrics.myCases,');
    expect(src).toContain('marketCases: caseMarketMetrics.marketCases,');
  });

  test('real function call: computeCaseMarketMetrics formats averages correctly with a fake pool', async () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');

    const formatMoneySrc = src.match(/function formatMoneyEurFromCents\(cents\) \{[\s\S]*?\n\}\n/)[0];
    const formatAvgSrc = src.match(/function formatAvgNumber\(value\) \{[\s\S]*?\n\}\n/)[0];
    const computeSrc = src.match(/async function computeCaseMarketMetrics\(pool, myCaseIds\) \{[\s\S]*?\n\}\n/)[0];

    // eslint-disable-next-line no-eval
    const computeCaseMarketMetrics = eval(`
      (function () {
        ${formatMoneySrc}
        ${formatAvgSrc}
        ${computeSrc}
        return computeCaseMarketMetrics;
      })()
    `);

    const fakePool = {
      query: async (sql, params) => {
        if (sql.includes('ANY($1::text[])')) {
          expect(params[0]).toEqual(['case-A', 'case-B']);
          return { rows: [{ avg_templates: '3.0', avg_rent_cost_cents: '200', nonempty_case_count: 1 }] };
        }
        return { rows: [{ avg_templates: '2.5', avg_rent_cost_cents: '450', nonempty_case_count: 4 }] };
      },
    };

    const result = await computeCaseMarketMetrics(fakePool, ['case-A', 'case-B']);

    expect(result.myCases.avgTemplates).toBe('3.0');
    expect(result.myCases.avgRentCostEur).toBe('2.00');
    expect(result.marketCases.avgTemplates).toBe('2.5');
    expect(result.marketCases.avgRentCostEur).toBe('4.50');
  });

  test('real function call: no crash and zeroed output when the user has no cases at all', async () => {
    const src = read('src/web/routes/cabinet.pages.routes.cjs');

    const formatMoneySrc = src.match(/function formatMoneyEurFromCents\(cents\) \{[\s\S]*?\n\}\n/)[0];
    const formatAvgSrc = src.match(/function formatAvgNumber\(value\) \{[\s\S]*?\n\}\n/)[0];
    const computeSrc = src.match(/async function computeCaseMarketMetrics\(pool, myCaseIds\) \{[\s\S]*?\n\}\n/)[0];

    // eslint-disable-next-line no-eval
    const computeCaseMarketMetrics = eval(`
      (function () {
        ${formatMoneySrc}
        ${formatAvgSrc}
        ${computeSrc}
        return computeCaseMarketMetrics;
      })()
    `);

    const fakePool = {
      query: async () => ({ rows: [{ avg_templates: 0, avg_rent_cost_cents: 0, nonempty_case_count: 0 }] }),
    };

    const result = await computeCaseMarketMetrics(fakePool, []);

    expect(result.myCases.avgTemplates).toBe('0.0');
    expect(result.myCases.avgRentCostEur).toBe('0.00');
  });
});
