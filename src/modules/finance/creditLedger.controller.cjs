// path: src/modules/finance/creditLedger.controller.cjs
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
