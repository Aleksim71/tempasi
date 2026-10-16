const assert = require("node:assert/strict");

describe("Finance Orders query service", () => {
  const service = require("../src/modules/finance/ordersQuery.service.cjs");

  test("buyer role queries by orders.user_id and resolves seller as counterparty", () => {
    const { sql, params, role } = service.buildOrdersQuery({ userId: 42, role: "buyer", filters: {} });

    assert.equal(role, "buyer");
    assert.match(sql, /WHERE o\.user_id = \$1/);
    assert.match(sql, /LEFT JOIN users cu ON cu\.id = t\.owner_user_id/);
    assert.deepEqual(params, [42]);
  });

  test("seller role queries by seller_templates.owner_user_id and resolves buyer as counterparty", () => {
    const { sql, params, role } = service.buildOrdersQuery({ userId: 42, role: "seller", filters: {} });

    assert.equal(role, "seller");
    assert.match(sql, /WHERE t\.owner_user_id = \$1/);
    assert.match(sql, /JOIN seller_templates t ON t\.slug = o\.template_slug/);
    assert.match(sql, /LEFT JOIN users cu ON cu\.id = o\.user_id/);
    assert.deepEqual(params, [42]);
  });

  test("an unknown role falls back to buyer", () => {
    const { role } = service.buildOrdersQuery({ userId: 1, role: "not-a-role", filters: {} });
    assert.equal(role, "buyer");
  });

  test("filters are applied as parameterized conditions, in order", () => {
    const { sql, params } = service.buildOrdersQuery({
      userId: 7,
      role: "buyer",
      filters: { q: "studio", type: "buy", dateFrom: "2026-01-01", dateTo: "2026-08-18" },
    });

    assert.match(sql, /UPPER\(o\.deal_type\) = \$2/);
    assert.match(sql, /o\.created_at::date >= \$3::date/);
    assert.match(sql, /o\.created_at::date <= \$4::date/);
    assert.match(sql, /ILIKE \$5/);
    assert.deepEqual(params, [7, "BUY", "2026-01-01", "2026-08-18", "%studio%"]);
  });

  test("garbage filter input is ignored rather than injected into SQL", () => {
    const { sql, params } = service.buildOrdersQuery({
      userId: 1,
      role: "buyer",
      filters: { type: "DROP TABLE orders;", dateFrom: "not-a-date", dateTo: "'; --" },
    });

    assert.ok(!sql.includes("DROP TABLE"));
    assert.deepEqual(params, [1]);
  });

  test("loadOrdersForUser maps rows, computes paid-only sums, and hides internal fields", async () => {
    const fakePool = {
      async query() {
        return {
          rows: [
            {
              id: 1,
              template_slug: "studio",
              deal_type: "BUY",
              status: "paid",
              created_at: new Date("2026-04-29"),
              amount_cents: 4900,
              template_title: "Studio, Minimal",
              counterparty: "Anna K.",
            },
            {
              id: 2,
              template_slug: "landing",
              deal_type: "RENT",
              status: "pending",
              created_at: new Date("2026-04-30"),
              amount_cents: 900,
              template_title: "Landing Pro",
              counterparty: "Max R.",
            },
            {
              id: 3,
              template_slug: "landing",
              deal_type: "RENT",
              status: "paid",
              created_at: new Date("2026-05-01"),
              amount_cents: 1200,
              template_title: "Landing Pro",
              counterparty: "Max R.",
            },
          ],
        };
      },
    };

    const { orders, summary } = await service.loadOrdersForUser(fakePool, {
      userId: 1,
      role: "seller",
      filters: {},
    });

    assert.equal(orders.length, 3);
    assert.equal(orders[0].amountEur, "49.00");
    assert.ok(!("_paidCents" in orders[0]), "internal accounting fields must not leak to the view model");

    assert.equal(summary.role, "seller");
    assert.equal(summary.counterpartyLabel, "Buyer");
    assert.equal(summary.sumLabel, "Income (paid)");
    assert.equal(summary.totalOrders, 3);
    assert.equal(summary.buyCount, 1);
    assert.equal(summary.rentCount, 2);
    assert.equal(summary.sumEur, "61.00", "only paid orders (49.00 + 12.00) should count toward the sum");
  });

  test("buyer role summary uses Procurement label", async () => {
    const fakePool = { async query() { return { rows: [] }; } };
    const { summary } = await service.loadOrdersForUser(fakePool, { userId: 1, role: "buyer", filters: {} });

    assert.equal(summary.counterpartyLabel, "Seller");
    assert.equal(summary.sumLabel, "Procurement (paid)");
    assert.equal(summary.totalOrders, 0);
    assert.equal(summary.sumEur, "0.00");
  });
});
