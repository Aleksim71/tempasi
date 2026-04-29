from pathlib import Path

# ---------------------------------------------------------------------
# Step 5P — Finance UX polish
# ---------------------------------------------------------------------

finance_partial = Path("src/web/views/partials/space-finance.hbs")
ledger_view = Path("src/web/views/finance/credit-ledger.hbs")
ui_test = Path("tests/financeCreditLedger.ui.test.cjs")

# ---------------------------------------------------------------------
# 1) Finance overview: add Credit ledger CTA near Tempasi credit KPI
# ---------------------------------------------------------------------

t = finance_partial.read_text(encoding="utf-8")

old = '''        <div class="finance-kpi">
          <div class="finance-kpi__label">Tempasi credit</div>
          <div class="finance-kpi__value">€{{workspaceData.finance.overview.creditBalanceEur}}</div>
        </div>
      </div>
    </div>
  {{/if}}'''

new = '''        <div class="finance-kpi">
          <div class="finance-kpi__label">Tempasi credit</div>
          <div class="finance-kpi__value">€{{workspaceData.finance.overview.creditBalanceEur}}</div>
          <div class="finance-kpi__hint">Reserved, applied, and released credit movements.</div>
        </div>
      </div>

      <div class="finance-credit-ledger-cta card">
        <div>
          <h4 class="finance-credit-ledger-cta__title">Credit ledger</h4>
          <p class="finance-credit-ledger-cta__text">
            Review Tempasi credit created from unused rent value and follow every checkout reservation,
            payment application, and release.
          </p>
        </div>
        <a class="button button--primary" href="/cabinet/finance/credit-ledger">Open credit ledger</a>
      </div>
    </div>
  {{/if}}'''

if old not in t:
    raise SystemExit(f"Pattern not found in {finance_partial}")

t = t.replace(old, new, 1)
finance_partial.write_text(t, encoding="utf-8")
print("PATCHED:", finance_partial)


# ---------------------------------------------------------------------
# 2) Credit ledger page: add back link + clearer intro + better empty state
# ---------------------------------------------------------------------

t = ledger_view.read_text(encoding="utf-8")

old = '''  <section class="cabinet-header">
    <p class="eyebrow">Finance</p>
    <h1>Credit ledger</h1>
    <p class="muted">History of Tempasi credit reservations, applications and releases.</p>
  </section>'''

new = '''  <section class="cabinet-header">
    <p class="eyebrow">Finance</p>
    <h1>Credit ledger</h1>
    <p class="muted">
      Audit trail for Tempasi credit created from unused rent value, checkout reservations,
      payment applications, and released reservations.
    </p>
    <p>
      <a class="button" href="/cabinet/finance">Back to Finance overview</a>
    </p>
  </section>'''

if old not in t:
    raise SystemExit(f"Header pattern not found in {ledger_view}")

t = t.replace(old, new, 1)

old = '''  {{else}}
    <section class="empty-state card">
      <h2>No credit entries yet</h2>
      <p>Your Tempasi credit history will appear here after rent conversion, checkout reservation, payment completion or checkout cancellation.</p>
    </section>
  {{/if}}'''

new = '''  {{else}}
    <section class="empty-state card">
      <h2>No Tempasi credit movements yet</h2>
      <p>
        Credits from unused converted rents will appear here first. After that, checkout reservations,
        payment applications, and released reservations will be listed as audit rows.
      </p>
      <p>
        <a class="button button--primary" href="/cabinet/finance">Back to Finance overview</a>
      </p>
    </section>
  {{/if}}'''

if old not in t:
    raise SystemExit(f"Empty-state pattern not found in {ledger_view}")

t = t.replace(old, new, 1)
ledger_view.write_text(t, encoding="utf-8")
print("PATCHED:", ledger_view)


# ---------------------------------------------------------------------
# 3) UI tests: assert Finance overview CTA + stronger ledger UX copy
# ---------------------------------------------------------------------

t = ui_test.read_text(encoding="utf-8")

anchor = '''  test("credit ledger view exposes user-facing UX copy and statuses", () => {
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");'''

replacement = '''  test("finance overview exposes credit ledger CTA", () => {
    const view = readProjectFile("src/web/views/partials/space-finance.hbs");

    assert.match(
      view,
      /Open credit ledger/i,
      "Finance overview should expose a clear CTA to the credit ledger"
    );

    assert.match(
      view,
      /\\/cabinet\\/finance\\/credit-ledger/i,
      "Finance overview should link directly to the credit ledger route"
    );

    assert.match(
      view,
      /Reserved, applied, and released credit movements|checkout reservation|payment application|release/i,
      "Finance overview should explain why the credit ledger matters"
    );
  });

  test("credit ledger view exposes user-facing UX copy and statuses", () => {
    const view = readProjectFile("src/web/views/finance/credit-ledger.hbs");'''

if anchor not in t:
    raise SystemExit(f"Test anchor not found in {ui_test}")

t = t.replace(anchor, replacement, 1)

old = '''    assert.match(
      view,
      /No Tempasi credit movements yet|No credit movements yet|Credits from unused converted rents will appear here|empty/i,
      "credit ledger view should have an understandable empty state"
    );
  });'''

new = '''    assert.match(
      view,
      /No Tempasi credit movements yet|Credits from unused converted rents will appear here|checkout reservations|released reservations/i,
      "credit ledger view should have an understandable empty state"
    );

    assert.match(
      view,
      /Back to Finance overview|\\/cabinet\\/finance/i,
      "credit ledger view should let users return to Finance overview"
    );
  });'''

if old not in t:
    raise SystemExit(f"Empty-state assertion pattern not found in {ui_test}")

t = t.replace(old, new, 1)
ui_test.write_text(t, encoding="utf-8")
print("PATCHED:", ui_test)

print("Step 5P patch created.")
