// path: src/modules/finance/ordersQuery.service.cjs
"use strict";

function formatMoneyEurFromCents(cents) {
  if (cents === null || cents === undefined) return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return (n / 100).toFixed(2);
}

function formatDateYMD(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function normalizeRole(role) {
  return role === "seller" ? "seller" : "buyer";
}

function normalizeType(type) {
  const upper = String(type || "").trim().toUpperCase();
  return upper === "BUY" || upper === "RENT" ? upper : "";
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

// Builds the WHERE clause + params shared by the page listing and the CSV
// export, so both stay in sync. `role` picks which side of the deal the
// current user is on:
//  - "buyer":  orders the user placed (orders.user_id)      -> counterparty = seller
//  - "seller": orders on templates the user owns/sells      -> counterparty = buyer
function buildOrdersQuery({ userId, role, filters = {} }) {
  const normalizedRole = normalizeRole(role);
  const type = normalizeType(filters.type);
  const dateFrom = normalizeDate(filters.dateFrom);
  const dateTo = normalizeDate(filters.dateTo);
  const q = String(filters.q || "").trim();

  const params = [userId];
  const conditions = [];
  let counterpartyJoin;
  let roleCondition;

  if (normalizedRole === "seller") {
    // The current user is the template owner; counterparty is the buyer.
    roleCondition = "t.owner_user_id = $1";
    counterpartyJoin = `
      JOIN seller_templates t ON t.slug = o.template_slug
      LEFT JOIN users cu ON cu.id = o.user_id
      LEFT JOIN user_profiles cp ON cp.user_id = cu.id
    `;
  } else {
    // The current user placed the order; counterparty is the seller/owner.
    roleCondition = "o.user_id = $1";
    counterpartyJoin = `
      LEFT JOIN seller_templates t ON t.slug = o.template_slug
      LEFT JOIN users cu ON cu.id = t.owner_user_id
      LEFT JOIN user_profiles cp ON cp.user_id = cu.id
    `;
  }

  conditions.push(roleCondition);

  if (type) {
    params.push(type);
    conditions.push(`UPPER(o.deal_type) = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`o.created_at::date >= $${params.length}::date`);
  }

  if (dateTo) {
    params.push(dateTo);
    conditions.push(`o.created_at::date <= $${params.length}::date`);
  }

  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(t.title ILIKE ${p} OR o.template_slug ILIKE ${p} OR cu.email ILIKE ${p} OR cp.nickname ILIKE ${p} OR cp.full_name ILIKE ${p})`
    );
  }

  const sql = `
    SELECT
      o.id,
      o.template_slug,
      o.deal_type,
      o.status,
      o.created_at,
      o.amount_cents,
      COALESCE(t.title, o.template_slug) AS template_title,
      COALESCE(NULLIF(TRIM(cp.nickname), ''), NULLIF(TRIM(cp.full_name), ''), cu.email, '—') AS counterparty
    FROM orders o
    ${counterpartyJoin}
    WHERE ${conditions.join(" AND ")}
    ORDER BY o.created_at DESC, o.id DESC
  `;

  return { sql, params, role: normalizedRole };
}

function mapRow(row) {
  const type = String(row.deal_type || "").toUpperCase();
  const cents = Number(row.amount_cents || 0);

  return {
    id: row.id,
    type,
    templateTitle: row.template_title || row.template_slug || "",
    counterparty: row.counterparty || "—",
    amountEur: formatMoneyEurFromCents(cents),
    status: row.status || "",
    date: formatDateYMD(row.created_at),
    caseTitle: "—",
    _paidCents: String(row.status || "").toLowerCase() === "paid" ? cents : 0,
    _isBuy: type === "BUY",
    _isRent: type === "RENT",
  };
}

function summarizeOrders(orders, role) {
  const totalOrders = orders.length;
  const buyCount = orders.filter((o) => o._isBuy).length;
  const rentCount = orders.filter((o) => o._isRent).length;
  const paidCents = orders.reduce((sum, o) => sum + o._paidCents, 0);

  return {
    role,
    counterpartyLabel: role === "seller" ? "Buyer" : "Seller",
    sumLabel: role === "seller" ? "Income (paid)" : "Procurement (paid)",
    totalOrders,
    buyCount,
    rentCount,
    sumEur: formatMoneyEurFromCents(paidCents),
  };
}

function stripInternalFields(order) {
  const { _paidCents, _isBuy, _isRent, ...rest } = order;
  return rest;
}

async function loadOrdersForUser(pool, { userId, role, filters }) {
  const { sql, params, role: normalizedRole } = buildOrdersQuery({ userId, role, filters });
  const { rows } = await pool.query(sql, params);
  const mapped = (rows || []).map(mapRow);
  const summary = summarizeOrders(mapped, normalizedRole);
  const orders = mapped.map(stripInternalFields);

  return { orders, summary, role: normalizedRole };
}

module.exports = {
  buildOrdersQuery,
  loadOrdersForUser,
  summarizeOrders,
  normalizeRole,
  normalizeType,
  normalizeDate,
  mapRow,
};
