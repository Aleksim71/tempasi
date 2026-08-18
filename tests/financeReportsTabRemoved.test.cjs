// path: tests/financeReportsTabRemoved.test.cjs
/* eslint-env node */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Finance Reports tab — removed', () => {
  test('cabinet routes no longer accept ?tab=reports or build a reports array', () => {
    const routes = readProjectFile('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).not.toMatch(/allowedTabs\s*=\s*new Set\(\['overview', 'orders', 'reports'\]\)/);
    expect(routes).toMatch(/allowedTabs\s*=\s*new Set\(\['overview', 'orders'\]\)/);
    expect(routes).not.toMatch(/key:\s*'reports'/);
    expect(routes).not.toMatch(/\breports\b/);

    // The Reports tab was the only consumer of this per-request query and
    // its buyCount/rentCount/paidBuyTotal/paidRentTotal bookkeeping —
    // removing Reports should have removed this dead SQL query too.
    expect(routes).not.toMatch(/overviewRows/);
  });

  test('Finance workspace template no longer renders a Reports panel', () => {
    const view = readProjectFile('src/web/views/partials/space-finance.hbs');

    expect(view).not.toMatch(/tab\s*"reports"/);
    expect(view).not.toMatch(/finance-report-card/);
    expect(view).not.toMatch(/Monthly summaries for review/i);
  });

  test('Finance CSS no longer carries Reports-only rules', () => {
    const css = readProjectFile('public/css/pages/cabinet-finance.css');

    expect(css).not.toMatch(/\.finance-reports\b/);
    expect(css).not.toMatch(/\.finance-report-card\b/);
  });
});
