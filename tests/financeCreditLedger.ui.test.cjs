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
      /No Tempasi credit movements yet|No credit movements yet|Credits from unused converted rents will appear here|empty/i,
      "credit ledger view should have an understandable empty state"
    );
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
