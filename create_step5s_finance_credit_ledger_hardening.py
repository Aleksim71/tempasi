from pathlib import Path

# Step 5S — Finance / Credit Ledger hardening
# Adds ledger row type, user-facing movement labels, summary cards and stronger UI tests.

service = Path("src/modules/finance/creditLedger.service.cjs")
controller = Path("src/modules/finance/creditLedger.controller.cjs")
view = Path("src/web/views/finance/credit-ledger.hbs")
css = Path("public/css/pages/cabinet-finance.css")
ui_test = Path("tests/financeCreditLedger.ui.test.cjs")

service_text = service.read_text(encoding="utf-8")
if "ledger_row_type: row.ledger_row_type" not in service_text:
    service_text = service_text.replace(
        """  return {
    id: row.usage_id || row.credit_id,
    credit_id: row.credit_id,
""",
        """  return {
    id: row.usage_id || row.credit_id,
    ledger_row_type: row.ledger_row_type || (row.usage_id ? "usage" : "created"),
    credit_id: row.credit_id,
"""
    )
service.write_text(service_text, encoding="utf-8")

controller.write_text(r'''// path: src/modules/finance/creditLedger.controller.cjs
"use strict";

const { listAccountCreditLedger } = require("./creditLedger.service.cjs");

function extractUserId(req) {
  return (
    req.user?.id ||
    req.user?.user_id ||
    req.session?.user?.id ||
    req.session?.userId ||
    req.session?.auth?.userId ||
    req.session?.passport?.user?.id ||
    req.session?.passport?.user ||
    null
  );
}

function tryRequire(path) {
  try {
    const value = require(path);
    if (value && typeof value.query === "function") return value;
    if (value && value.pool && typeof value.pool.query === "function") return value.pool;
    if (value && value.db && typeof value.db.query === "function") return value.db;
    return null;
  } catch (_) {
    return null;
  }
}

function getDb(req) {
  const candidates = [
    req.db,
    req.pool,
    req.app?.locals?.db,
    req.app?.locals?.pool,
    req.app?.locals?.database,
    tryRequire("../../db/pool.cjs"),
    tryRequire("../../db/index.cjs"),
    tryRequire("../../database/pool.cjs"),
    tryRequire("../../config/db.cjs"),
  ];

  return candidates.find((candidate) => candidate && typeof candidate.query === "function") || null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateLabel(value) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toISOString().slice(0, 10);
}

function formatAmountLabel(value) {
  const cents = Number(value || 0);
  const eur = cents / 100;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
  }).format(eur);
}

function formatStatusLabel(value) {
  return String(value || "created").trim().toLowerCase();
}

function formatReasonLabel(value) {
  const text = String(value || "").trim();
  return text || "—";
}

function humanizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildMovementLabel(row, status) {
  const rowType = String(row.ledger_row_type || "").toLowerCase();

  if (rowType === "created" || status === "created") {
    return "Credit created";
  }

  if (status === "reserved") {
    return "Checkout reservation";
  }

  if (status === "applied" || status === "used" || status === "completed") {
    return "Payment application";
  }

  if (status === "released" || status === "cancelled" || status === "canceled") {
    return "Reservation release";
  }

  return humanizeToken(status || rowType || "movement") || "Credit movement";
}

function toCreditLedgerViewModel(row) {
  const status = formatStatusLabel(row.status || row.usage_status || row.credit_status);
  const amountCents =
    row.amount_cents ??
    row.amountCents ??
    row.usage_amount_cents ??
    row.credit_amount_cents ??
    0;

  const createdAt =
    row.created_at ||
    row.createdAt ||
    row.usage_created_at ||
    row.usage_updated_at ||
    row.usage_applied_at ||
    row.usage_released_at ||
    row.credit_created_at ||
    null;

  const ledgerRowType = row.ledger_row_type || (row.usage_id ? "usage" : "created");

  return {
    ...row,
    ledger_row_type: ledgerRowType,
    type_label: humanizeToken(ledgerRowType),
    status,
    status_label: row.status_label || status,
    status_text: row.status_text || humanizeToken(status),
    movement_label: row.movement_label || buildMovementLabel(row, status),
    amount_cents: amountCents,
    amountCents,
    amount_label: row.amount_label || formatAmountLabel(amountCents),
    created_at: createdAt,
    createdAt,
    created_label: row.created_label || formatDateLabel(createdAt),
    reason_label: row.reason_label || formatReasonLabel(row.reason || row.usage_reason || row.credit_reason),
    order_id: row.order_id || null,
    rent_id: row.rent_id || row.rent_order_id || null,
  };
}

function buildCreditLedgerViewModel(rows) {
  return Array.isArray(rows) ? rows.map(toCreditLedgerViewModel) : [];
}

function buildCreditLedgerSummary(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const totalCreatedCents = items
    .filter((item) => item.status === "created" || item.ledger_row_type === "created")
    .reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);

  const reservedCount = items.filter((item) => item.status === "reserved").length;
  const appliedCount = items.filter((item) => ["applied", "used", "completed"].includes(item.status)).length;
  const releasedCount = items.filter((item) => ["released", "cancelled", "canceled"].includes(item.status)).length;

  return {
    hasRows: items.length > 0,
    totalRows: items.length,
    totalCreatedLabel: formatAmountLabel(totalCreatedCents),
    reservedCount,
    appliedCount,
    releasedCount,
  };
}

function renderFallbackHtml(res, data) {
  const rows = data.creditLedger.map((item) => `
    <tr>
      <td>${escapeHtml(item.created_label)}</td>
      <td>${escapeHtml(item.movement_label)}</td>
      <td>${escapeHtml(item.status_text)}</td>
      <td>${escapeHtml(item.amount_label)}</td>
      <td>${escapeHtml(item.reason_label)}</td>
      <td>${escapeHtml(item.order_id || "—")}</td>
      <td>${escapeHtml(item.rent_id || "—")}</td>
    </tr>
  `).join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tempasi Credit Ledger</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f5ef;color:#1f2933}
    main{max-width:1120px;margin:0 auto;padding:32px 20px}
    .card{background:#fff;border:1px solid #e6dfcf;border-radius:18px;padding:24px;box-shadow:0 12px 32px rgba(31,41,51,.08)}
    h1{margin:0 0 8px;font-size:30px}.muted{color:#64748b;margin-bottom:22px}
    .summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 18px}
    .summary div{background:#fff;border:1px solid #e6dfcf;border-radius:14px;padding:14px}
    .summary strong{display:block;font-size:22px}
    table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #eee;text-align:left;font-size:14px}
    th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}.empty{padding:20px;border:1px dashed #cbd5e1;border-radius:14px;color:#64748b}
  </style>
</head>
<body><main><section class="card">
  <h1>Credit ledger</h1>
  <p class="muted">History of Tempasi credit reservations, applications and releases.</p>
  ${data.error ? `<p class="empty">${escapeHtml(data.error)}</p>` : ""}
  ${data.creditLedgerSummary.hasRows ? `
    <div class="summary">
      <div><span>Total rows</span><strong>${data.creditLedgerSummary.totalRows}</strong></div>
      <div><span>Credit created</span><strong>${escapeHtml(data.creditLedgerSummary.totalCreatedLabel)}</strong></div>
      <div><span>Reserved</span><strong>${data.creditLedgerSummary.reservedCount}</strong></div>
      <div><span>Applied</span><strong>${data.creditLedgerSummary.appliedCount}</strong></div>
    </div>
    <table><thead><tr><th>Date</th><th>Movement</th><th>Status</th><th>Amount</th><th>Reason</th><th>Order</th><th>Rent</th></tr></thead><tbody>${rows}</tbody></table>
  ` : `<div class="empty">No credit ledger entries yet.</div>`}
</section></main></body></html>`);
}

async function handleCreditLedger(req, res, next) {
  try {
    const userId = extractUserId(req);
    const db = getDb(req);
    const data = {
      title: "Credit ledger",
      activeCabinetSpace: "finance",
      userId,
      creditLedger: [],
      creditLedgerSummary: buildCreditLedgerSummary([]),
      error: null,
    };

    if (!userId) {
      data.error = "Please sign in to view your Tempasi credit ledger.";
    } else if (!db) {
      data.error = "Credit ledger is not connected to the database pool yet.";
    } else {
      data.creditLedger = buildCreditLedgerViewModel(await listAccountCreditLedger(db, userId));
      data.creditLedgerSummary = buildCreditLedgerSummary(data.creditLedger);
    }

    if (typeof res.render === "function") {
      return res.render("finance/credit-ledger", data, (err, html) => {
        if (err) return renderFallbackHtml(res, data);
        return res.send(html);
      });
    }

    return renderFallbackHtml(res, data);
  } catch (error) {
    if (typeof next === "function") return next(error);
    throw error;
  }
}

module.exports = {
  handleCreditLedger,
  buildCreditLedgerViewModel,
  buildCreditLedgerSummary,
};
''', encoding="utf-8")

view.write_text(r'''{{!-- path: src/web/views/finance/credit-ledger.hbs --}}
<main class="cabinet cabinet-finance">
  <section class="cabinet-header">
    <p class="eyebrow">Finance</p>
    <h1>Credit ledger</h1>
    <p class="muted">
      Audit trail for Tempasi credit created from unused rent value, checkout reservations,
      payment applications, and released reservations.
    </p>
    <p>
      <a class="button" href="/cabinet/finance">Back to Finance overview</a>
    </p>
  </section>

  {{#if error}}
    <section class="notice notice-warning">{{error}}</section>
  {{/if}}

  {{#if creditLedgerSummary.hasRows}}
    <section class="finance-ledger-summary card" aria-label="Credit ledger summary">
      <article class="finance-ledger-summary__item">
        <span>Total rows</span>
        <strong>{{creditLedgerSummary.totalRows}}</strong>
      </article>
      <article class="finance-ledger-summary__item">
        <span>Credit created</span>
        <strong>{{creditLedgerSummary.totalCreatedLabel}}</strong>
      </article>
      <article class="finance-ledger-summary__item">
        <span>Reserved</span>
        <strong>{{creditLedgerSummary.reservedCount}}</strong>
      </article>
      <article class="finance-ledger-summary__item">
        <span>Applied</span>
        <strong>{{creditLedgerSummary.appliedCount}}</strong>
      </article>
      <article class="finance-ledger-summary__item">
        <span>Released</span>
        <strong>{{creditLedgerSummary.releasedCount}}</strong>
      </article>
    </section>

    <section class="card table-card">
      <div class="finance-ledger-table-head">
        <div>
          <h2>Credit movements</h2>
          <p class="muted">
            Use this table to audit when credit was created, reserved for checkout,
            applied to payment, or released back to the account.
          </p>
        </div>
      </div>

      <table class="ledger-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Movement</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Reason</th>
            <th>Order</th>
            <th>Rent</th>
          </tr>
        </thead>
        <tbody>
          {{#each creditLedger}}
            <tr data-ledger-row-type="{{this.ledger_row_type}}" data-ledger-status="{{this.status_label}}">
              <td>{{this.created_label}}</td>
              <td>
                <strong>{{this.movement_label}}</strong>
                <span class="ledger-row-type">{{this.type_label}}</span>
              </td>
              <td><span class="status-pill status-{{this.status_label}}">{{this.status_text}}</span></td>
              <td>{{this.amount_label}}</td>
              <td>{{this.reason_label}}</td>
              <td>{{#if this.order_id}}{{this.order_id}}{{else}}—{{/if}}</td>
              <td>{{#if this.rent_id}}{{this.rent_id}}{{else}}—{{/if}}</td>
            </tr>
          {{/each}}
        </tbody>
      </table>
    </section>
  {{else}}
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
  {{/if}}
</main>
''', encoding="utf-8")

css_text = css.read_text(encoding="utf-8")
marker = "/* Step 5S — Finance credit ledger hardening */"
if marker not in css_text:
    css_text += r'''

/* Step 5S — Finance credit ledger hardening */
.finance-ledger-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.875rem;
  margin-bottom: 1rem;
}

.finance-ledger-summary__item {
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.76);
  padding: 1rem;
}

.finance-ledger-summary__item span {
  display: block;
  color: #64748b;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.finance-ledger-summary__item strong {
  display: block;
  margin-top: 0.35rem;
  color: #172033;
  font-size: 1.35rem;
  line-height: 1.2;
}

.finance-ledger-table-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.finance-ledger-table-head h2 {
  margin: 0 0 0.35rem;
}

.ledger-row-type {
  display: block;
  margin-top: 0.2rem;
  color: #64748b;
  font-size: 0.78rem;
}

.ledger-table tr[data-ledger-row-type="created"] td:first-child {
  border-left: 3px solid rgba(34, 197, 94, 0.55);
}

.ledger-table tr[data-ledger-status="reserved"] td:first-child {
  border-left: 3px solid rgba(59, 130, 246, 0.55);
}

.ledger-table tr[data-ledger-status="applied"] td:first-child,
.ledger-table tr[data-ledger-status="used"] td:first-child,
.ledger-table tr[data-ledger-status="completed"] td:first-child {
  border-left: 3px solid rgba(16, 185, 129, 0.55);
}

.ledger-table tr[data-ledger-status="released"] td:first-child,
.ledger-table tr[data-ledger-status="cancelled"] td:first-child,
.ledger-table tr[data-ledger-status="canceled"] td:first-child {
  border-left: 3px solid rgba(245, 158, 11, 0.6);
}

@media (max-width: 900px) {
  .finance-ledger-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .finance-ledger-table-head {
    flex-direction: column;
  }
}

@media (max-width: 560px) {
  .finance-ledger-summary {
    grid-template-columns: 1fr;
  }
}
'''
css.write_text(css_text, encoding="utf-8")

ui_text = ui_test.read_text(encoding="utf-8")
if "credit ledger view exposes summary cards and movement labels" not in ui_text:
    insert = r'''
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

'''
    ui_text = ui_text.replace(
        '  test("credit ledger controller renders the Finance ledger page for an authenticated user", async () => {',
        insert + '  test("credit ledger controller renders the Finance ledger page for an authenticated user", async () => {'
    )
ui_test.write_text(ui_text, encoding="utf-8")

print("STEP_5S_PATCHED")
print(service)
print(controller)
print(view)
print(css)
print(ui_test)
