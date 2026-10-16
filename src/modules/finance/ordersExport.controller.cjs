// path: src/modules/finance/ordersExport.controller.cjs
"use strict";

const { getPool } = require("../../../scripts/db.pool.cjs");
const { loadOrdersForUser, normalizeRole } = require("./ordersQuery.service.cjs");

function extractUserId(req) {
  return (
    req?.user?.id ||
    req?.user?.user_id ||
    req?.user?.userId ||
    req?.userId ||
    req?.session?.user?.id ||
    req?.session?.userId ||
    null
  );
}

// Mirrors the Orders tab table columns for the active role: the
// counterparty column is "Seller" when exporting orders placed by the
// user, and "Buyer" when exporting orders on templates the user sells.
function csvColumnsForRole(role) {
  const counterpartyHeader = role === "seller" ? "Buyer" : "Seller";

  return [
    { header: "Order", key: "id" },
    { header: "Type", key: "type" },
    { header: "Template", key: "templateTitle" },
    { header: counterpartyHeader, key: "counterparty" },
    { header: "Amount EUR", key: "amountEur" },
    { header: "Date", key: "date" },
    { header: "Case", key: "caseTitle" },
  ];
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);
  const mustQuote = /[",\n\r]/.test(text) || /^\s|\s$/.test(text);

  if (!mustQuote) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function buildOrdersCsv(orders, role) {
  const items = Array.isArray(orders) ? orders : [];
  const columns = csvColumnsForRole(role);
  const header = columns.map((column) => column.header);
  const body = items.map((item) => columns.map((column) => item[column.key] ?? ""));

  return [header, ...body]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n") + "\n";
}

function buildOrdersExportFilename(role, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const stamp = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  const suffix = role === "seller" ? "sales" : "purchases";

  return `tempasi-orders-${suffix}-${stamp}.csv`;
}

function setOrdersCsvHeaders(res, filename) {
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

async function handleOrdersCsv(req, res, next) {
  try {
    const userId = extractUserId(req);

    if (!userId) {
      if (typeof res.status === "function") res.status(401);
      if (typeof res.type === "function") res.type("text/plain");
      return res.send("Please sign in to export your Tempasi orders.\n");
    }

    const role = normalizeRole(req.query?.role);
    const filters = {
      q: String(req.query?.q || "").trim(),
      type: String(req.query?.type || "").trim(),
      dateFrom: String(req.query?.date_from || "").trim(),
      dateTo: String(req.query?.date_to || "").trim(),
    };

    const pool = getPool();
    const { orders } = await loadOrdersForUser(pool, { userId, role, filters });

    const csv = buildOrdersCsv(orders, role);
    const filename = buildOrdersExportFilename(role);

    setOrdersCsvHeaders(res, filename);

    return res.send(csv);
  } catch (error) {
    if (typeof next === "function") return next(error);
    throw error;
  }
}

module.exports = {
  handleOrdersCsv,
  buildOrdersCsv,
  buildOrdersExportFilename,
  setOrdersCsvHeaders,
  csvColumnsForRole,
};
