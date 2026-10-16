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

describe("Finance Orders CSV export", () => {
  test("cabinet routes expose a protected CSV export endpoint for Orders", () => {
    const routes = readProjectFile("src/web/routes/cabinet.pages.routes.cjs");

    assert.ok(
      routes.includes("router.get('/finance/orders/export.csv', requireAuthPage, OrdersExportController.handleOrdersCsv);")
        || routes.includes('router.get("/finance/orders/export.csv", requireAuthPage, OrdersExportController.handleOrdersCsv);'),
      "cabinet routes should expose a protected CSV export endpoint for Orders"
    );
  });

  test("Orders tab exposes role switch, income/procurement summary, real filters, and a Download CSV CTA", () => {
    const view = readProjectFile("src/web/views/partials/space-finance.hbs");

    assert.match(view, /workspaceData\.finance\.ordersRoles/, "Orders tab should render a role switch nav");
    assert.match(view, /Download CSV/i, "Orders tab should expose a Download CSV button");
    assert.match(view, /\/cabinet\/finance\/orders\/export\.csv/i, "Download CSV should target the export route");
    assert.match(view, /name="role" value="\{\{workspaceData\.finance\.ordersRole\}\}"/, "filter form should carry the active role");
    assert.match(view, /ordersSummary\.sumLabel/, "Orders tab should show the Income/Procurement summary");

    assert.doesNotMatch(
      view,
      /financeDirection|financeStatus|financeLicense/i,
      "Orders tab should not reintroduce the removed Direction/Status/License filter fields"
    );
  });

  test("CSV builder switches the counterparty column by role and escapes values", () => {
    const controller = require("../src/modules/finance/ordersExport.controller.cjs");

    const buyerCsv = controller.buildOrdersCsv(
      [{ id: 1, type: "BUY", templateTitle: "Studio, Minimal", counterparty: 'Anna "K"', amountEur: "49.00", date: "2026-04-29", caseTitle: "—" }],
      "buyer"
    );
    assert.match(buyerCsv, /^Order,Type,Template,Seller,Amount EUR,Date,Case/);
    assert.match(buyerCsv, /"Studio, Minimal"/);
    assert.match(buyerCsv, /"Anna ""K"""/);
    assert.ok(buyerCsv.endsWith("\n"));

    const sellerCsv = controller.buildOrdersCsv(
      [{ id: 2, type: "RENT", templateTitle: "Landing", counterparty: "Max R.", amountEur: "9.00", date: "2026-04-30", caseTitle: "Client A" }],
      "seller"
    );
    assert.match(sellerCsv, /^Order,Type,Template,Buyer,Amount EUR,Date,Case/);
  });

  test("export filename is deterministic and reflects the role (purchases vs sales)", () => {
    const controller = require("../src/modules/finance/ordersExport.controller.cjs");

    assert.equal(
      controller.buildOrdersExportFilename("buyer", new Date("2026-04-29T17:00:00Z")),
      "tempasi-orders-purchases-2026-04-29.csv"
    );
    assert.equal(
      controller.buildOrdersExportFilename("seller", new Date("2026-04-29T17:00:00Z")),
      "tempasi-orders-sales-2026-04-29.csv"
    );
  });

  test("CSV export sets hardened download headers", () => {
    const controller = require("../src/modules/finance/ordersExport.controller.cjs");
    const headers = {};

    controller.setOrdersCsvHeaders(
      { setHeader(name, value) { headers[name.toLowerCase()] = value; } },
      "tempasi-orders-sales-2026-04-29.csv"
    );

    assert.equal(headers["content-type"], "text/csv; charset=utf-8");
    assert.equal(headers["content-disposition"], 'attachment; filename="tempasi-orders-sales-2026-04-29.csv"');
    assert.equal(headers["cache-control"], "no-store");
    assert.equal(headers["x-content-type-options"], "nosniff");
  });

  test("Orders CSV export rejects anonymous access before database lookup", async () => {
    const controller = require("../src/modules/finance/ordersExport.controller.cjs");

    const req = { query: {} };
    const calls = [];
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; calls.push(["status", code]); return this; },
      type(value) { calls.push(["type", value]); return this; },
      send(body) { calls.push(["send", body]); return body; },
    };

    let nextError = null;
    await controller.handleOrdersCsv(req, res, (err) => { nextError = err; });

    assert.equal(nextError, null);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(calls[0], ["status", 401]);
    assert.deepEqual(calls[1], ["type", "text/plain"]);
    assert.match(calls[2][1], /Please sign in/i);
  });

  test("route enforces auth via real HTTP (redirects anonymous requests to /login)", async () => {
    const express = require("express");
    const request = require("supertest");
    const { createCabinetPagesRouter } = require("../src/web/routes/cabinet.pages.routes.cjs");

    const app = express();
    app.use("/cabinet", createCabinetPagesRouter());

    const res = await request(app).get("/cabinet/finance/orders/export.csv?role=seller");

    assert.equal(res.status, 302);
    assert.match(res.headers.location, /\/login/);
  });
});
