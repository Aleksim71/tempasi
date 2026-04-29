// path: src/modules/finance/creditLedger.service.cjs
"use strict";

function quoteIdent(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

async function getTableColumns(db, tableName) {
  const result = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

function pickColumn(columns, candidates) {
  for (const name of candidates) {
    if (columns.has(name)) return name;
  }
  return null;
}

function selectExpr(columns, candidates, alias, fallbackSql = "NULL") {
  const col = pickColumn(columns, candidates);
  if (!col) return `${fallbackSql} AS ${quoteIdent(alias)}`;
  return `${quoteIdent(col)} AS ${quoteIdent(alias)}`;
}

async function listAccountCreditLedger(db, userId, options = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Credit ledger requires a db/pool object with query(sql, params).");
  }
  if (!userId) return [];

  const limit = Math.max(1, Math.min(Number(options.limit || 100), 500));

  const usagesColumns = await getTableColumns(db, "account_credit_usages");
  if (!usagesColumns.size) {
    return [];
  }

  const userColumn = pickColumn(usagesColumns, [
    "user_id",
    "buyer_user_id",
    "buyer_id",
    "account_user_id",
    "owner_user_id",
    "customer_user_id",
  ]);

  if (!userColumn) {
    throw new Error(
      "Cannot build credit ledger: account_credit_usages has no known user column."
    );
  }

  const createdColumn = pickColumn(usagesColumns, ["created_at", "inserted_at", "created_on"]);
  const updatedColumn = pickColumn(usagesColumns, ["updated_at", "modified_at", "released_at", "applied_at"]);
  const orderByColumn = updatedColumn || createdColumn || "id";

  const select = [
    selectExpr(usagesColumns, ["id"], "id"),
    selectExpr(usagesColumns, ["status", "state"], "status", "'unknown'"),
    selectExpr(usagesColumns, ["amount_cents", "credit_amount_cents", "used_amount_cents", "reserved_amount_cents"], "amount_cents", "0"),
    selectExpr(usagesColumns, ["reason", "source", "kind", "type"], "reason", "''"),
    selectExpr(usagesColumns, ["order_id", "payment_order_id"], "order_id"),
    selectExpr(usagesColumns, ["rent_id", "rental_id", "reservation_id"], "rent_id"),
    selectExpr(usagesColumns, ["template_id"], "template_id"),
    selectExpr(usagesColumns, ["provider_session_id", "stripe_session_id"], "provider_session_id"),
    selectExpr(usagesColumns, ["created_at", "inserted_at", "created_on"], "created_at"),
    selectExpr(usagesColumns, ["updated_at", "modified_at", "released_at", "applied_at"], "updated_at"),
  ].join(",\n        ");

  const sql = `
    SELECT ${select}
      FROM account_credit_usages
     WHERE ${quoteIdent(userColumn)} = $1
     ORDER BY ${quoteIdent(orderByColumn)} DESC NULLS LAST, id DESC
     LIMIT $2
  `;

  const result = await db.query(sql, [userId, limit]);
  return result.rows.map((row) => {
    const amountCents = Number(row.amount_cents || 0);
    return {
      ...row,
      amount_cents: amountCents,
      amount_label: `${(amountCents / 100).toFixed(2)} €`,
      created_label: row.created_at ? new Date(row.created_at).toISOString().slice(0, 16).replace("T", " ") : "—",
      updated_label: row.updated_at ? new Date(row.updated_at).toISOString().slice(0, 16).replace("T", " ") : "—",
      reason_label: row.reason || "—",
      status_label: row.status || "unknown",
    };
  });
}

module.exports = {
  listAccountCreditLedger,
};
