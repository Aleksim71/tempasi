const { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}


afterAll(async () => {
  await closeDbAfterTest();
});

describe("Finance credit ledger UI", () => {
  test("cabinet routes expose a Finance credit ledger route", () => {
    const routes = readProjectFile("src/web/routes/cabinet.pages.routes.cjs");

    assert.match(
      routes,
      /credit-ledger|creditLedger|finance/i,
      "cabinet routes should expose the Finance credit ledger page"
    );

    assert.match(
      routes,
      /creditLedger\.controller|creditLedgerController|creditLedger/i,
      "cabinet routes should be wired to the credit ledger controller"
    );
  });

  test("finance overview exposes credit ledger CTA", () => {
    const view = readProjectFile("src/web/views/partials/space-finance.hbs");

    assert.match(
      view,
      /Open credit ledger/i,
      "Finance overview should expose a clear CTA to the credit ledger"
    );

    assert.match(
      view,
      /\/cabinet\/finance\/credit-ledger/i,
      "Finance overview should link directly to the credit ledger route"
    );

    assert.match(
      view,
      /Reserved, applied, and released credit movements|checkout reservation|payment application|release/i,
      "Finance overview should explain why the credit ledger matters"
    );
  });

  test("finance credit ledger CSS covers CTA, table, status pills and empty state", () => {
    const css = readProjectFile("public/css/pages/cabinet-finance.css");

    assert.match(
      css,
      /finance-credit-ledger-cta/,
      "Finance CSS should style the credit ledger CTA"
    );

    assert.match(
      css,
      /finance-kpi__hint/,
      "Finance CSS should style the Tempasi credit KPI hint"
    );

    assert.match(
      css,
      /ledger-table/,
      "Finance CSS should style the credit ledger table"
    );

    assert.match(
      css,
      /status-pill|status-created|status-reserved|status-applied|status-released/,
      "Finance CSS should style ledger status pills"
    );

    assert.match(
      css,
      /empty-state/,
      "Finance CSS should style the ledger empty state"
    );
  });

  test("credit ledger view exposes user-facing UX copy and statuses", () => {
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");

    assert.match(
      view,
      /Tempasi credit|Credit ledger|credit movements|credit history|Finance/i,
      "credit ledger view should explain that this page shows Tempasi credit movements"
    );

    assert.match(
      view,
      /reserved|applied|released|created/i,
      "credit ledger view should expose ledger status labels"
    );

    assert.match(
      view,
      /No Tempasi credit movements yet|Credits from unused converted rents will appear here|checkout reservations|released reservations/i,
      "credit ledger view should have an understandable empty state"
    );

    assert.match(
      view,
      /Back to Finance overview|\/cabinet\/finance/i,
      "credit ledger view should let users return to Finance overview"
    );
  });


  test("credit ledger view exposes summary cards and movement labels", () => {
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");

    assert.match(
      view,
      /Credit ledger summary|finance-ledger-summary|Total rows|Credit created|Reserved|Applied|Released/i,
      "credit ledger view should expose summary cards for audit readability"
    );

    assert.match(
      view,
      /Movement|movement_label|ledger_row_type|data-ledger-status/i,
      "credit ledger view should expose movement labels and row metadata"
    );
  });

  test("credit ledger controller exports summary builder for finance audit rows", () => {
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    assert.equal(
      typeof controller.buildCreditLedgerSummary,
      "function",
      "credit ledger controller should export buildCreditLedgerSummary"
    );

    const summary = controller.buildCreditLedgerSummary([
      { status: "created", ledger_row_type: "created", amount_cents: 500 },
      { status: "reserved", ledger_row_type: "usage", amount_cents: 200 },
      { status: "applied", ledger_row_type: "usage", amount_cents: 200 },
      { status: "released", ledger_row_type: "usage", amount_cents: 100 },
    ]);

    assert.equal(summary.hasRows, true);
    assert.equal(summary.totalRows, 4);
    assert.equal(summary.reservedCount, 1);
    assert.equal(summary.appliedCount, 1);
    assert.equal(summary.releasedCount, 1);
    assert.equal(summary.totalCreatedLabel, "€5.00");
  });

  test("credit ledger controller renders the Finance ledger page for an authenticated user", async () => {
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    const controllerEntries = Object.entries(controller).filter(
      ([, value]) => typeof value === "function"
    );

    assert.ok(
      controllerEntries.length > 0,
      "creditLedger.controller.cjs should export at least one controller function"
    );

    const [, handler] =
      controllerEntries.find(([name]) => /ledger|credit|finance|render/i.test(name)) ||
      controllerEntries[0];

    let rendered = null;
    let redirected = null;

    const req = {
      user: { id: 42, email: "ledger-user@example.test" },
      session: {
        user: { id: 42, email: "ledger-user@example.test" },
        userId: 42,
      },
      isAuthenticated: () => true,
    };

    const res = {
      render(viewName, locals) {
        rendered = { viewName, locals };
      },
      redirect(target) {
        redirected = target;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
    };

    let nextError = null;
    const next = (err) => {
      if (err) nextError = err;
    };

    await handler(req, res, next);

    assert.equal(nextError, null, `controller should not call next(error): ${nextError && nextError.message}`);
    assert.equal(redirected, null, `authenticated user should not be redirected: ${redirected}`);
    assert.ok(rendered, "controller should render the Finance credit ledger page");

    assert.match(
      rendered.viewName,
      /finance|credit|ledger/i,
      "controller should render a finance/credit/ledger view"
    );

    assert.ok(
      rendered.locals && typeof rendered.locals === "object",
      "controller should pass locals to the ledger view"
    );
  });
});
