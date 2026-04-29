// path: src/modules/finance/creditLedger.service.cjs
const dbModule = require("../../config/db.cjs");

function isQueryClient(value) {
  return Boolean(value && typeof value.query === "function");
}

function getDefaultDbClient() {
  if (isQueryClient(dbModule)) {
    return dbModule;
  }

  if (dbModule && isQueryClient(dbModule.pool)) {
    return dbModule.pool;
  }

  if (dbModule && isQueryClient(dbModule.db)) {
    return dbModule.db;
  }

  if (dbModule && isQueryClient(dbModule.default)) {
    return dbModule.default;
  }

  throw new TypeError("Tempasi DB module does not expose a supported query client.");
}

function resolveArgs(firstArg, secondArg) {
  if (isQueryClient(firstArg)) {
    return {
      client: firstArg,
      userId: secondArg,
    };
  }

  return {
    client: getDefaultDbClient(),
    userId: firstArg,
  };
}

function normalizeUserId(value) {
  if (value && typeof value === "object") {
    if (value.id != null) return value.id;
    if (value.user_id != null) return value.user_id;
    if (value.userId != null) return value.userId;
  }

  return value;
}

async function query(client, sql, params = []) {
  return client.query(sql, params);
}

async function getTableColumns(client, tableName) {
  const result = await query(
    client,
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position`,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
}

function pickColumn(columns, candidates) {
  return candidates.find((name) => columns.includes(name)) || null;
}

function sqlNullOrColumn(aliasPrefix, columns, candidates, alias) {
  const column = pickColumn(columns, candidates);
  return column ? `${aliasPrefix}.${column} AS ${alias}` : `NULL AS ${alias}`;
}

function buildCreditSelect(columns) {
  return [
    "c.id AS credit_id",
    sqlNullOrColumn("c", columns, ["amount_cents", "original_amount_cents", "total_amount_cents"], "credit_amount_cents"),
    sqlNullOrColumn("c", columns, ["remaining_amount_cents", "available_amount_cents", "balance_cents"], "credit_remaining_cents"),
    sqlNullOrColumn("c", columns, ["status"], "credit_status"),
    sqlNullOrColumn("c", columns, ["reason", "source", "source_type", "kind"], "credit_reason"),
    sqlNullOrColumn("c", columns, ["created_at"], "credit_created_at"),
  ];
}

function buildUsageSelect(columns, relationColumn) {
  return [
    "u.id AS usage_id",
    `u.${relationColumn} AS credit_relation_id`,
    sqlNullOrColumn("u", columns, ["amount_cents", "used_amount_cents", "reserved_amount_cents"], "usage_amount_cents"),
    sqlNullOrColumn("u", columns, ["status"], "usage_status"),
    sqlNullOrColumn("u", columns, ["reason", "source", "source_type", "kind"], "usage_reason"),
    sqlNullOrColumn("u", columns, ["order_id"], "order_id"),
    sqlNullOrColumn("u", columns, ["created_at"], "usage_created_at"),
    sqlNullOrColumn("u", columns, ["updated_at"], "usage_updated_at"),
    sqlNullOrColumn("u", columns, ["applied_at"], "usage_applied_at"),
    sqlNullOrColumn("u", columns, ["released_at"], "usage_released_at"),
  ];
}

function normalizeLedgerRow(row) {
  const status =
    row.usage_status ||
    row.credit_status ||
    "created";

  const amountCents =
    row.usage_amount_cents ??
    row.credit_amount_cents ??
    0;

  const createdAt =
    row.usage_created_at ||
    row.usage_updated_at ||
    row.usage_applied_at ||
    row.usage_released_at ||
    row.credit_created_at ||
    null;

  return {
    id: row.usage_id || row.credit_id,
    credit_id: row.credit_id,
    usage_id: row.usage_id || null,
    account_credit_id: row.credit_relation_id || row.credit_id,
    order_id: row.order_id || null,
    status,
    amount_cents: amountCents,
    amountCents,
    amount_eur: Number(amountCents || 0) / 100,
    reason: row.usage_reason || row.credit_reason || null,
    created_at: createdAt,
    createdAt,
    credit_status: row.credit_status || null,
    credit_remaining_cents: row.credit_remaining_cents ?? null,
  };
}

async function listAccountCreditLedger(firstArg, secondArg) {
  const { client, userId: rawUserId } = resolveArgs(firstArg, secondArg);
  const userId = normalizeUserId(rawUserId);

  if (!userId) {
    return [];
  }

  const creditColumns = await getTableColumns(client, "account_credits");
  const usageColumns = await getTableColumns(client, "account_credit_usages");

  if (!creditColumns.includes("id")) {
    throw new Error("Cannot build credit ledger: account_credits.id is missing.");
  }

  if (!usageColumns.includes("id")) {
    throw new Error("Cannot build credit ledger: account_credit_usages.id is missing.");
  }

  const userColumn = pickColumn(creditColumns, [
    "user_id",
    "owner_user_id",
    "buyer_id",
    "account_user_id",
    "created_by_user_id",
  ]);

  if (!userColumn) {
    throw new Error("Cannot build credit ledger: account_credits has no known user column.");
  }

  const relationColumn = pickColumn(usageColumns, [
    "account_credit_id",
    "credit_id",
    "account_credit_ref_id",
    "source_account_credit_id",
  ]);

  if (!relationColumn) {
    throw new Error(
      `Cannot build credit ledger: account_credit_usages has no known credit relation column. Columns: ${usageColumns.join(", ")}`
    );
  }

  const creditSelect = buildCreditSelect(creditColumns);
  const usageSelect = buildUsageSelect(usageColumns, relationColumn);

  const createdAmountColumn = pickColumn(creditColumns, [
    "amount_cents",
    "original_amount_cents",
    "total_amount_cents",
  ]);
  const createdAmountExpression = createdAmountColumn
    ? `c.${createdAmountColumn}`
    : "0";

  const createdReasonColumn = pickColumn(creditColumns, [
    "reason",
    "source",
    "source_type",
    "kind",
  ]);
  const createdReasonExpression = createdReasonColumn
    ? `c.${createdReasonColumn}`
    : "NULL";

  const usageOrderByColumn =
    pickColumn(usageColumns, ["created_at", "updated_at", "applied_at", "released_at"]) ||
    "id";

  const creditOrderByColumn =
    pickColumn(creditColumns, ["created_at", "updated_at"]) ||
    "id";

  const sql = `
    SELECT *
    FROM (
      SELECT
        'usage' AS ledger_row_type,
        ${[...creditSelect, ...usageSelect].join(",\n        ")}
      FROM account_credit_usages u
      JOIN account_credits c
        ON c.id = u.${relationColumn}
      WHERE c.${userColumn} = $1

      UNION ALL

      SELECT
        'created' AS ledger_row_type,
        ${creditSelect.join(",\n        ")},
        NULL AS usage_id,
        c.id AS credit_relation_id,
        ${createdAmountExpression} AS usage_amount_cents,
        'created' AS usage_status,
        ${createdReasonExpression} AS usage_reason,
        NULL AS order_id,
        c.${creditOrderByColumn} AS usage_created_at,
        NULL AS usage_updated_at,
        NULL AS usage_applied_at,
        NULL AS usage_released_at
      FROM account_credits c
      WHERE c.${userColumn} = $1
    ) ledger
    ORDER BY usage_created_at DESC NULLS LAST, usage_id DESC NULLS LAST, credit_id DESC
  `;

  const result = await query(client, sql, [userId]);
  return result.rows.map(normalizeLedgerRow);
}

module.exports = {
  listAccountCreditLedger,
};
