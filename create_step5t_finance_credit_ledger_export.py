# path: create_step5t_finance_credit_ledger_export.py
"""
Tempasi Step 5T — Finance credit ledger CSV export.

Run from /home/aleksim/tempasi:
  python3 create_step5t_finance_credit_ledger_export.py

What it changes:
- adds CSV export support to creditLedger.controller.cjs
- wires /cabinet/finance/credit-ledger/export.csv
- adds export CTA to the credit ledger page
- adds CSS for export actions
- extends UI tests for audit/export behavior
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()
MARKER = "Step 5T — Finance credit ledger CSV export"


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"PATCHED: {rel}")


def backup(rel: str) -> None:
    path = ROOT / rel
    if not path.exists():
        return
    backup_dir = ROOT / ".step5t_backups"
    backup_dir.mkdir(exist_ok=True)
    dst = backup_dir / rel.replace("/", "__")
    dst.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")


def patch_controller() -> None:
    rel = "src/modules/finance/creditLedger.controller.cjs"
    text = read(rel)
    if MARKER in text:
        print(f"SKIP: {rel} already contains Step 5T patch")
        return

    backup(rel)

    insert = r'''

// Step 5T — Finance credit ledger CSV export
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCreditLedgerCsv(rows) {
  const items = buildCreditLedgerViewModel(rows);
  const header = [
    "Date",
    "Movement",
    "Status",
    "Amount EUR",
    "Reason",
    "Order ID",
    "Rent ID",
    "Row type",
    "Credit ID",
    "Usage ID",
  ];

  const body = items.map((item) => [
    item.created_label,
    item.movement_label,
    item.status_text,
    item.amount_label,
    item.reason_label,
    item.order_id || "",
    item.rent_id || "",
    item.type_label,
    item.credit_id || "",
    item.usage_id || "",
  ]);

  return [header, ...body]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n") + "\n";
}

async function handleCreditLedgerCsv(req, res, next) {
  try {
    const userId = extractUserId(req);
    const db = getDb(req);

    if (!userId) {
      if (typeof res.status === "function") res.status(401);
      return res.type("text/plain").send("Please sign in to export your Tempasi credit ledger.\n");
    }

    if (!db) {
      if (typeof res.status === "function") res.status(503);
      return res.type("text/plain").send("Credit ledger is not connected to the database pool yet.\n");
    }

    const rows = await listAccountCreditLedger(db, userId);
    const csv = buildCreditLedgerCsv(rows);
    const filename = `tempasi-credit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;

    if (typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    } else if (typeof res.type === "function") {
      res.type("text/csv");
    }

    return res.send(csv);
  } catch (error) {
    if (typeof next === "function") return next(error);
    throw error;
  }
}
'''

    text = text.replace("\nmodule.exports = {", insert + "\nmodule.exports = {")
    text = text.replace(
        "  handleCreditLedger,\n  buildCreditLedgerViewModel,\n  buildCreditLedgerSummary,\n};",
        "  handleCreditLedger,\n  handleCreditLedgerCsv,\n  buildCreditLedgerViewModel,\n  buildCreditLedgerSummary,\n  buildCreditLedgerCsv,\n};",
    )
    write(rel, text)


def patch_routes() -> None:
    rel = "src/web/routes/cabinet.pages.routes.cjs"
    text = read(rel)
    route = "router.get('/finance/credit-ledger/export.csv', requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);"
    if route in text:
        print(f"SKIP: {rel} already has CSV export route")
        return

    backup(rel)
    needle = "  router.get('/finance/credit-ledger', requireAuthPage, CreditLedgerController.handleCreditLedger);"
    if needle not in text:
        raise SystemExit(f"Cannot patch {rel}: credit ledger route not found")

    text = text.replace(needle, f"  {route}\n{needle}")
    write(rel, text)


def patch_view() -> None:
    rel = "src/web/views/finance/credit-ledger.hbs"
    text = read(rel)
    if "/cabinet/finance/credit-ledger/export.csv" in text:
        print(f"SKIP: {rel} already has export CTA")
        return

    backup(rel)
    old = '''    <p>
      <a class="button" href="/cabinet/finance">Back to Finance overview</a>
    </p>'''
    new = '''    <div class="finance-ledger-actions" aria-label="Credit ledger actions">
      <a class="button" href="/cabinet/finance">Back to Finance overview</a>
      <a class="button button--secondary" href="/cabinet/finance/credit-ledger/export.csv">Export CSV</a>
    </div>'''
    if old not in text:
        raise SystemExit(f"Cannot patch {rel}: header action block not found")
    text = text.replace(old, new)

    old2 = '''      <div class="finance-ledger-table-head">
        <div>
          <h2>Credit movements</h2>
          <p class="muted">
            Use this table to audit when credit was created, reserved for checkout,
            applied to payment, or released back to the account.
          </p>
        </div>
      </div>'''
    new2 = '''      <div class="finance-ledger-table-head">
        <div>
          <h2>Credit movements</h2>
          <p class="muted">
            Use this table to audit when credit was created, reserved for checkout,
            applied to payment, or released back to the account.
          </p>
        </div>
        <a class="button button--secondary" href="/cabinet/finance/credit-ledger/export.csv">Export CSV</a>
      </div>'''
    if old2 not in text:
        raise SystemExit(f"Cannot patch {rel}: table head block not found")
    text = text.replace(old2, new2)
    write(rel, text)


def patch_css() -> None:
    rel = "public/css/pages/cabinet-finance.css"
    text = read(rel)
    if "Step 5T — Finance credit ledger export" in text:
        print(f"SKIP: {rel} already has Step 5T CSS")
        return

    backup(rel)
    text += r'''

/* Step 5T — Finance credit ledger export */
.finance-ledger-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.finance-ledger-actions .button,
.finance-ledger-table-head .button {
  white-space: nowrap;
}

@media (max-width: 560px) {
  .finance-ledger-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .finance-ledger-actions .button,
  .finance-ledger-table-head .button {
    justify-content: center;
    width: 100%;
  }
}
'''
    write(rel, text)


def patch_ui_tests() -> None:
    rel = "tests/financeCreditLedger.ui.test.cjs"
    text = read(rel)
    if "buildCreditLedgerCsv" in text and "export.csv" in text:
        print(f"SKIP: {rel} already has Step 5T tests")
        return

    backup(rel)

    test_block = r'''

  test("credit ledger exposes CSV export route, CTA and export builder", () => {
    const routes = readProjectFile("src/web/routes/cabinet.pages.routes.cjs");
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");
    const css = readProjectFile("public/css/pages/cabinet-finance.css");
    const controller = require("../src/modules/finance/creditLedger.controller.cjs");

    assert.match(
      routes,
      /\/finance\/credit-ledger\/export\.csv/i,
      "cabinet routes should expose a CSV export endpoint for the credit ledger"
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
'''

    insert_before = "\n});\n"
    if insert_before not in text:
        raise SystemExit(f"Cannot patch {rel}: test suite end not found")
    text = text.replace(insert_before, test_block + insert_before)
    write(rel, text)


def main() -> None:
    expected = ROOT / "package.json"
    if not expected.exists():
      raise SystemExit("Run this script from the Tempasi project root: /home/aleksim/tempasi")

    patch_controller()
    patch_routes()
    patch_view()
    patch_css()
    patch_ui_tests()

    print("\nStep 5T patch created.")
    print("Next commands:")
    print("  npm test -- --runInBand tests/financeCreditLedger.ui.test.cjs tests/creditLedger.service.test.cjs tests/creditLedger.integration.test.cjs")
    print("  git status --short")


if __name__ == "__main__":
    main()
