# path: fix_step5t_ui_test_and_db_env.py
"""
Tempasi Step 5T hotfix.

Run from /home/aleksim/tempasi:
  python3 fix_step5t_ui_test_and_db_env.py

Fixes:
- removes the misplaced Step 5T CSV test if it was accidentally inserted inside afterAll()
- reinserts the Step 5T CSV test inside describe("Finance credit ledger UI", ...)
- keeps all production code changes from create_step5t_finance_credit_ledger_export.py intact
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()
REL = "tests/financeCreditLedger.ui.test.cjs"
TEST_NAME = 'test("credit ledger exposes CSV export route, CTA and export builder"'


def find_matching_brace(text: str, open_index: int) -> int:
    depth = 0
    in_single = False
    in_double = False
    in_template = False
    in_line_comment = False
    in_block_comment = False
    escape = False

    i = open_index
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if in_single or in_double or in_template:
            if escape:
                escape = False
                i += 1
                continue
            if ch == "\\":
                escape = True
                i += 1
                continue
            if in_single and ch == "'":
                in_single = False
            elif in_double and ch == '"':
                in_double = False
            elif in_template and ch == "`":
                in_template = False
            i += 1
            continue

        if ch == "/" and nxt == "/":
            in_line_comment = True
            i += 2
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue
        if ch == "'":
            in_single = True
            i += 1
            continue
        if ch == '"':
            in_double = True
            i += 1
            continue
        if ch == "`":
            in_template = True
            i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1

    raise RuntimeError("matching brace not found")


def remove_existing_step5t_tests(text: str) -> str:
    while TEST_NAME in text:
        test_pos = text.index(TEST_NAME)
        start = text.rfind("\n", 0, test_pos)
        if start == -1:
            start = 0
        else:
            start += 1

        arrow_pos = text.find("=>", test_pos)
        if arrow_pos == -1:
            raise RuntimeError("cannot locate Step 5T test arrow")
        open_brace = text.find("{", arrow_pos)
        if open_brace == -1:
            raise RuntimeError("cannot locate Step 5T test body")
        close_brace = find_matching_brace(text, open_brace)

        end = close_brace + 1
        # Consume trailing test call close: ); plus whitespace/newline.
        while end < len(text) and text[end].isspace():
            end += 1
        if text.startswith(");", end):
            end += 2
        while end < len(text) and text[end] in " \t\r\n":
            end += 1

        text = text[:start].rstrip() + "\n\n" + text[end:].lstrip()
    return text


def find_describe_end(text: str) -> int:
    marker = 'describe("Finance credit ledger UI"'
    describe_pos = text.find(marker)
    if describe_pos == -1:
        raise RuntimeError("Finance credit ledger UI describe block not found")
    arrow_pos = text.find("=>", describe_pos)
    if arrow_pos == -1:
        raise RuntimeError("cannot locate describe arrow")
    open_brace = text.find("{", arrow_pos)
    if open_brace == -1:
        raise RuntimeError("cannot locate describe body")
    close_brace = find_matching_brace(text, open_brace)
    return close_brace


def main() -> None:
    if not (ROOT / "package.json").exists():
        raise SystemExit("Run this script from /home/aleksim/tempasi")

    path = ROOT / REL
    text = path.read_text(encoding="utf-8")
    backup = ROOT / ".step5t_backups" / "tests__financeCreditLedger.ui.test.cjs.hotfix-before"
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(text, encoding="utf-8")

    text = remove_existing_step5t_tests(text)

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

    insert_at = find_describe_end(text)
    text = text[:insert_at].rstrip() + "\n\n" + test_block + "\n" + text[insert_at:]

    path.write_text(text, encoding="utf-8")
    print(f"PATCHED: {REL}")
    print(f"BACKUP: {backup}")
    print("Next: run Jest with DATABASE_URL and DATABASE_URL_TEST pointing to the same working test DB URL.")


if __name__ == "__main__":
    main()
