// path: tests/financeOverviewRole.service.test.cjs
/* eslint-env node */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Finance Overview role switch — buyer-side summary service', () => {
  let queryMock;

  beforeEach(() => {
    jest.resetModules();
    queryMock = jest.fn();
    jest.doMock('../scripts/db.pool.cjs', () => ({
      getPool: () => ({ query: queryMock }),
    }));
  });

  afterEach(() => {
    jest.dontMock('../scripts/db.pool.cjs');
  });

  test('getMyOrdersBuyRentSummary queries by orders.user_id directly (no seller_templates join)', async () => {
    queryMock.mockResolvedValue({
      rows: [{ buy_count: 2, buy_cents: 9800, rent_count: 3, rent_cents: 2700 }],
    });

    // eslint-disable-next-line global-require
    const service = require('../src/web/modules/analytics/analytics.cabinet.service.cjs');
    expect(typeof service.getMyOrdersBuyRentSummary).toBe('function');

    const result = await service.getMyOrdersBuyRentSummary({ userId: 55, days: 7 });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/WHERE o\.user_id = \$1/);
    expect(sql).not.toContain('seller_templates');
    expect(params).toEqual([55, 7]);

    expect(result.buyCount).toBe(2);
    expect(result.buySumEur).toBe('98.00');
    expect(result.rentCount).toBe(3);
    expect(result.rentSumEur).toBe('27.00');
  });

  test('getMyOrdersBuyRentSummary rejects a missing userId before querying', async () => {
    // eslint-disable-next-line global-require
    const service = require('../src/web/modules/analytics/analytics.cabinet.service.cjs');

    await expect(service.getMyOrdersBuyRentSummary({ userId: null, days: 7 })).rejects.toThrow(
      'USER_ID_REQUIRED',
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  test('getMyOrdersBuyRentSummary defaults an invalid days value to 28', async () => {
    queryMock.mockResolvedValue({
      rows: [{ buy_count: 0, buy_cents: 0, rent_count: 0, rent_cents: 0 }],
    });

    // eslint-disable-next-line global-require
    const service = require('../src/web/modules/analytics/analytics.cabinet.service.cjs');
    await service.getMyOrdersBuyRentSummary({ userId: 1, days: 'not-a-number' });

    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([1, 28]);
  });
});

describe('Finance Overview role switch — routing and markup', () => {
  test('cabinet routes parse an overview role query param, defaulting to buyer', () => {
    const routes = readProjectFile('src/web/routes/cabinet.pages.routes.cjs');

    expect(routes).toMatch(/overviewRole/);
    expect(routes).toMatch(/allowedOverviewRoles\s*=\s*new Set\(\['buyer', 'seller'\]\)/);
    expect(routes).toMatch(/getMyOrdersBuyRentSummary/);
    expect(routes).toMatch(/getMyTemplatesBuyRentSummary/);
  });

  test('Overview tab renders a role switch nav and role-aware KPI labels', () => {
    const view = readProjectFile('src/web/views/partials/space-finance.hbs');
    const routes = readProjectFile('src/web/routes/cabinet.pages.routes.cjs');

    expect(view).toMatch(/workspaceData\.finance\.overviewRoles/);
    expect(view).toMatch(/buyRent\.buyCountLabel/);
    expect(view).toMatch(/buyRent\.rentCountLabel/);

    // Role labels themselves are data, defined in the route (mirrors Orders).
    expect(routes).toMatch(/Bought \/ Rented/);
    expect(routes).toMatch(/Sold \/ Rented out/);

    // The Balance section must stay outside any role-conditional block —
    // it's the user's own account credit, not scoped to buyer/seller.
    const balanceIndex = view.indexOf('finance-summary-card--balance');
    const overviewRolesIndex = view.indexOf('workspaceData.finance.overviewRoles');
    expect(balanceIndex).toBeGreaterThan(overviewRolesIndex);
  });
});
