# path: create_step5u_finance_csv_export_hardening.py
from pathlib import Path
import shutil
import os

ROOT = Path(os.environ.get('TEMPASI_ROOT', '/home/aleksim/tempasi'))
BACKUP = ROOT / '.step5u_backups'
BACKUP.mkdir(parents=True, exist_ok=True)


def read(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def write(rel, text):
    path = ROOT / rel
    backup = BACKUP / rel
    backup.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(text, encoding='utf-8')
    print(f'PATCHED: {rel}')


def replace_between(text, start_marker, end_marker, replacement):
    start = text.find(start_marker)
    if start == -1:
        raise SystemExit(f'Marker not found: {start_marker}')
    end = text.find(end_marker, start)
    if end == -1:
        raise SystemExit(f'End marker not found after: {start_marker}')
    return text[:start] + replacement + text[end:]


controller_rel = 'src/modules/finance/creditLedger.controller.cjs'
controller = read(controller_rel)

step5u_block = r'''
// Step 5U — Finance credit ledger CSV export hardening
const CREDIT_LEDGER_CSV_COLUMNS = Object.freeze([
  { header: "Date", key: "created_label" },
  { header: "Movement", key: "movement_label" },
  { header: "Status", key: "status_text" },
  { header: "Amount EUR", key: "amount_label" },
  { header: "Reason", key: "reason_label" },
  { header: "Order ID", key: "order_id" },
  { header: "Rent ID", key: "rent_id" },
  { header: "Row type", key: "type_label" },
  { header: "Credit ID", key: "credit_id" },
  { header: "Usage ID", key: "usage_id" },
]);

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);
  const mustQuote = /[",\n\r]/.test(text) || /^\s|\s$/.test(text);

  if (!mustQuote) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildCreditLedgerCsv(rows) {
  const items = buildCreditLedgerViewModel(rows);
  const header = CREDIT_LEDGER_CSV_COLUMNS.map((column) => column.header);
  const body = items.map((item) => CREDIT_LEDGER_CSV_COLUMNS.map((column) => item[column.key] || ""));

  return [header, ...body]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n") + "\n";
}

function buildCreditLedgerExportFilename(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const stamp = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);

  return `tempasi-credit-ledger-${stamp}.csv`;
}

function setCreditLedgerCsvHeaders(res, filename) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return;
  }

  if (typeof res.type === "function") {
    res.type("text/csv");
  }
}

async function handleCreditLedgerCsv(req, res, next) {
  try {
    const userId = extractUserId(req);

    if (!userId) {
      if (typeof res.status === "function") res.status(401);
      if (typeof res.type === "function") res.type("text/plain");
      return res.send("Please sign in to export your Tempasi credit ledger.\n");
    }

    const db = getDb(req);

    if (!db) {
      if (typeof res.status === "function") res.status(503);
      if (typeof res.type === "function") res.type("text/plain");
      return res.send("Credit ledger is not connected to the database pool yet.\n");
    }

    const rows = await listAccountCreditLedger(db, userId);
    const csv = buildCreditLedgerCsv(rows);
    const filename = buildCreditLedgerExportFilename();

    setCreditLedgerCsvHeaders(res, filename);

    return res.send(csv);
  } catch (error) {
    if (typeof next === "function") return next(error);
    throw error;
  }
}

'''

controller = replace_between(
    controller,
    '// Step 5T — Finance credit ledger CSV export',
    'module.exports = {',
    step5u_block,
)

exports_old = '''  buildCreditLedgerSummary,
  buildCreditLedgerCsv,
};'''
exports_new = '''  buildCreditLedgerSummary,
  buildCreditLedgerCsv,
  buildCreditLedgerExportFilename,
  setCreditLedgerCsvHeaders,
};'''
if exports_new not in controller:
    if exports_old not in controller:
        raise SystemExit('Expected module.exports block not found in controller')
    controller = controller.replace(exports_old, exports_new)

write(controller_rel, controller)

# Strengthen route test expectations and add export hardening tests.
test_rel = 'tests/financeCreditLedger.ui.test.cjs'
test = read(test_rel)

old_route_assert = r'''    assert.match(
      routes,
      /\/finance\/credit-ledger\/export\.csv/i,
      "cabinet routes should expose a CSV export endpoint for the credit ledger"
    );'''
new_route_assert = r'''    assert.match(
      routes,
      /router\.get\(['\"]\\/finance\\/credit-ledger\\/export\\.csv['\"],\s*requireAuthPage,\s*CreditLedgerController\.handleCreditLedgerCsv\)/,
      "cabinet routes should expose a protected CSV export endpoint for the credit ledger"
    );'''
if old_route_assert in test:
    test = test.replace(old_route_assert, new_route_assert)
elif 'protected CSV export endpoint' not in test:
    raise SystemExit('Expected Step 5T route assertion not found')

insert_after = '''    assert.match(csv, /"checkout, with comma"/);
  });'''
addition = r'''
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
  });'''

if 'rejects anonymous access before database lookup' not in test:
    if insert_after not in test:
        raise SystemExit('Expected insertion point not found in UI test')
    test = test.replace(insert_after, addition)

write(test_rel, test)

print('\nStep 5U patch created.')
print('Next commands:')
print('  DATABASE_URL=postgres://tempasi:tempasi@127.0.0.1:5432/tempasi_test DATABASE_URL_TEST=postgres://tempasi:tempasi@127.0.0.1:5432/tempasi_test npm test')
print('  git status --short')
