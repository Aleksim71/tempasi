from pathlib import Path

css_path = Path("public/css/pages/cabinet-finance.css")
ui_test = Path("tests/financeCreditLedger.ui.test.cjs")

css_path.parent.mkdir(parents=True, exist_ok=True)
css = css_path.read_text(encoding="utf-8") if css_path.exists() else ""

block = r'''
/* Step 5R — Finance credit ledger visual polish */

.finance-kpi__hint {
  margin-top: 0.35rem;
  color: var(--muted, #6b7280);
  font-size: 0.85rem;
  line-height: 1.35;
}

.finance-credit-ledger-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
  padding: 1rem;
}

.finance-credit-ledger-cta__title {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  font-weight: 700;
}

.finance-credit-ledger-cta__text {
  margin: 0;
  color: var(--muted, #6b7280);
  line-height: 1.45;
}

.cabinet-finance .cabinet-header {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.cabinet-finance .table-card {
  overflow-x: auto;
}

.ledger-table {
  width: 100%;
  border-collapse: collapse;
}

.ledger-table th,
.ledger-table td {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--border, #e5e7eb);
  text-align: left;
  vertical-align: top;
}

.ledger-table th {
  color: var(--muted, #6b7280);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  background: var(--surface-muted, #f3f4f6);
  color: var(--text, #111827);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.2;
}

.status-created {
  background: #eef2ff;
  color: #3730a3;
}

.status-reserved {
  background: #fff7ed;
  color: #9a3412;
}

.status-applied {
  background: #ecfdf5;
  color: #047857;
}

.status-released {
  background: #fef2f2;
  color: #b91c1c;
}

.cabinet-finance .empty-state.card {
  padding: 1.25rem;
}

.cabinet-finance .empty-state h2 {
  margin-top: 0;
}

@media (max-width: 720px) {
  .finance-credit-ledger-cta {
    align-items: flex-start;
    flex-direction: column;
  }

  .ledger-table th,
  .ledger-table td {
    padding: 0.65rem 0.6rem;
  }
}
'''

if "Step 5R — Finance credit ledger visual polish" not in css:
    if css and not css.endswith("\n"):
        css += "\n"
    css += block
    css_path.write_text(css, encoding="utf-8")
    print("PATCHED:", css_path)
else:
    print("SKIP: Step 5R CSS already present:", css_path)


# Add static CSS coverage to UI test.
t = ui_test.read_text(encoding="utf-8")

anchor = '''  test("credit ledger view exposes user-facing UX copy and statuses", () => {
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");'''

new_test = '''  test("finance credit ledger CSS covers CTA, table, status pills and empty state", () => {
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
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");'''

if "finance credit ledger CSS covers CTA" not in t:
    if anchor not in t:
        raise SystemExit(f"Test anchor not found in {ui_test}")
    t = t.replace(anchor, new_test, 1)
    ui_test.write_text(t, encoding="utf-8")
    print("PATCHED:", ui_test)
else:
    print("SKIP: Step 5R UI test already present:", ui_test)

print("Step 5R CSS/UI patch created.")
