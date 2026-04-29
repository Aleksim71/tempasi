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


  test("credit ledger exposes CSV export route, CTA and export builder", () => {
    const routes = readProjectFile("src/web/routes/cabinet.pages.routes.cjs");
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");
    const css = readProjectFile("public/css/pages/cabinet-finance.css");
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    assert.ok(
      routes.includes("router.get('/finance/credit-ledger/export.csv', requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);")
        || routes.includes('router.get("/finance/credit-ledger/export.csv", requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);'),
      "cabinet routes should expose a protected CSV export endpoint for the credit ledger"
    );

    assert.match(
      view,
      /Export CSV|\/cabinet\/finance\/credit-ledger\/export\.csv/i,
      "credit ledger view should expose a clear CSV export CTA"
    );

    assert.match(
      css,
      /finance-ledger-actions/i,
      "Finance CSS should style credit ledger export actions"
    );

    assert.equal(
      typeof controller.buildCreditLedgerCsv,
      "function",
      "credit ledger controller should export buildCreditLedgerCsv"
    );

    const csv = controller.buildCreditLedgerCsv([
      {
        ledger_row_type: "created",
        status: "created",
        amount_cents: 1200,
        reason: "rent_conversion",
        credit_id: 77,
        usage_id: null,
        created_at: new Date("2026-04-29T12:00:00Z"),
      },
      {
        ledger_row_type: "usage",
        status: "applied",
        amount_cents: 500,
        reason: "checkout, with comma",
        order_id: 9001,
        credit_id: 77,
        usage_id: 88,
        created_at: new Date("2026-04-29T12:05:00Z"),
      },
    ]);

    assert.match(csv, /Date,Movement,Status,Amount EUR,Reason,Order ID,Rent ID,Row type,Credit ID,Usage ID/);
    assert.match(csv, /Credit created/);
    assert.match(csv, /Payment application/);
    assert.match(csv, /€12\.00/);

    assert.match(csv, /"checkout, with comma"/);
  });

  test("credit ledger CSV export escapes risky values and exposes hardened headers", () => {
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    assert.equal(
      typeof controller.buildCreditLedgerExportFilename,
      "function",
      "credit ledger controller should export deterministic CSV filename builder"
    );

    assert.equal(
      typeof controller.setCreditLedgerCsvHeaders,
      "function",
      "credit ledger controller should export CSV header setter"
    );

    const filename = controller.buildCreditLedgerExportFilename(new Date("2026-04-29T17:00:00Z"));
    assert.equal(filename, "tempasi-credit-ledger-2026-04-29.csv");

    const headers = {};
    controller.setCreditLedgerCsvHeaders({
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
    }, filename);

    assert.equal(headers["content-type"], "text/csv; charset=utf-8");
    assert.equal(headers["content-disposition"], 'attachment; filename="tempasi-credit-ledger-2026-04-29.csv"');
    assert.equal(headers["cache-control"], "no-store");
    assert.equal(headers["x-content-type-options"], "nosniff");

    const csv = controller.buildCreditLedgerCsv([
      {
        ledger_row_type: "usage",
        status: "released",
        amount_cents: 300,
        reason: 'quote "inside" and\nnew line',
        order_id: "  spaced-order  ",
        rent_id: "rent-1",
        credit_id: 10,
        usage_id: 11,
        created_at: new Date("2026-04-29T18:00:00Z"),
      },
    ]);

    assert.match(csv, /"quote ""inside"" and\nnew line"/);
    assert.match(csv, /"  spaced-order  "/);
    assert.ok(csv.endsWith("\n"), "CSV export should end with a final newline");
  });

  test("credit ledger CSV export rejects anonymous access before database lookup", async () => {
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    const calls = [];
    const req = {
      db: {
        query() {
          throw new Error("anonymous export must not query the database");
        },
      },
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        calls.push(["status", code]);
        return this;
      },
      type(value) {
        calls.push(["type", value]);
        return this;
      },
      send(body) {
        calls.push(["send", body]);
        return body;
      },
    };

    let nextError = null;
    await controller.handleCreditLedgerCsv(req, res, (err) => {
      nextError = err;
    });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(calls[0], ["status", 401]);
    assert.deepEqual(calls[1], ["type", "text/plain"]);
    assert.match(calls[2][1], /Please sign in/i);
  });

});
