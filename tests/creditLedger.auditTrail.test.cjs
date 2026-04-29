// tests/creditLedger.auditTrail.test.cjs
const { describe, it, expect, beforeAll, afterAll } = require("@jest/globals");
const { Pool } = require("pg");
const { listAccountCreditLedger } = require("../src/modules/finance/creditLedger.service.cjs");
const { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");

const DATABASE_URL =
  process.env.DATABASE_URL_TEST ||
  "postgres://tempasi:tempasi@127.0.0.1:5433/tempasi_test";

const pool = new Pool({ connectionString: DATABASE_URL });

function uniqueSuffix() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function tableColumns(tableName) {
  const result = await pool.query(
    `
      select
        column_name,
        data_type,
        is_nullable,
        column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName]
  );

  return result.rows;
}

function hasColumn(columns, name) {
  return columns.some((column) => column.column_name === name);
}

function defaultValueForColumn(column, suffix) {
  const name = column.column_name;
  const type = column.data_type;

  if (column.column_default) return undefined;

  if (name === "email") return `step5o_${suffix}@example.test`;
  if (name === "password_hash") return "test_password_hash";
  if (name === "name") return `Step 5O User ${suffix}`;
  if (name === "display_name") return `Step 5O User ${suffix}`;
  if (name === "title") return `Step 5O Title ${suffix}`;
  if (name === "slug") return `step5o-${suffix}`;
  if (name === "license") return "PU";
  if (name === "deal_type") return "BUY";
  if (name === "status") return "paid";
  if (name === "currency") return "eur";

  if (type === "boolean") return false;
  if (type === "integer" || type === "bigint" || type === "smallint") return 0;
  if (type === "numeric" || type === "real" || type === "double precision") return 0;
  if (type === "timestamp without time zone" || type === "timestamp with time zone") {
    return new Date();
  }
  if (type === "json" || type === "jsonb") return {};
  if (type === "ARRAY") return [];

  return `step5o_${suffix}`;
}

async function insertDynamic(tableName, preferredValues) {
  const columns = await tableColumns(tableName);
  const suffix = uniqueSuffix();

  const values = {};

  for (const [key, value] of Object.entries(preferredValues)) {
    if (hasColumn(columns, key)) {
      values[key] = value;
    }
  }

  for (const column of columns) {
    if (column.column_name === "id") continue;
    if (column.column_name in values) continue;
    if (column.is_nullable === "NO" && !column.column_default) {
      const value = defaultValueForColumn(column, suffix);
      if (value !== undefined) {
        values[column.column_name] = value;
      }
    }
  }

  const keys = Object.keys(values);
  const placeholders = keys.map((_, index) => `$${index + 1}`);

  const result = await pool.query(
    `
      insert into ${tableName} (${keys.join(", ")})
      values (${placeholders.join(", ")})
      returning *
    `,
    keys.map((key) => values[key])
  );

  return result.rows[0];
}

async function cleanupUser(userId) {
  await pool.query(
    `
      delete from account_credit_usages
      where credit_id in (
        select id from account_credits where user_id = $1
      )
    `,
    [userId]
  );

  await pool.query("delete from account_credits where user_id = $1", [userId]);

  await pool.query(
    `
      delete from orders
      where buyer_id = $1
         or user_id = $1
         or customer_id = $1
    `.replace(/\s+or\s+\w+_id = \$1/g, (match) => match),
    [userId]
  ).catch(async () => {
    const columns = await tableColumns("orders");
    const possibleUserColumns = ["buyer_id", "user_id", "customer_id"].filter((name) =>
      hasColumn(columns, name)
    );

    for (const column of possibleUserColumns) {
      await pool.query(`delete from orders where ${column} = $1`, [userId]);
    }
  });

  await pool.query("delete from users where id = $1", [userId]);
}

async function createOrderForUser(userId, suffix) {
  const orderColumns = await tableColumns("orders");

  const userColumn =
    ["buyer_id", "user_id", "customer_id"].find((name) => hasColumn(orderColumns, name)) ||
    null;

  const preferred = {
    license: "PU",
    deal_type: "BUY",
    status: "paid",
    currency: "eur",
    amount_cents: 1000,
    total_cents: 1000,
    payable_amount_cents: 1000,
    created_at: new Date("2026-04-29T10:00:00.000Z"),
    updated_at: new Date("2026-04-29T10:00:00.000Z"),
  };

  if (userColumn) {
    preferred[userColumn] = userId;
  }

  return insertDynamic("orders", preferred);
}

describe("credit ledger audit trail consistency", () => {
  let userId;

  beforeAll(async () => {
    const suffix = uniqueSuffix();

    const user = await insertDynamic("users", {
      email: `step5o_${suffix}@example.test`,
      password_hash: "test_password_hash",
      name: "Step 5O Audit User",
      created_at: new Date("2026-04-29T09:00:00.000Z"),
      updated_at: new Date("2026-04-29T09:00:00.000Z"),
    });

    userId = user.id;

    const orderA = await createOrderForUser(userId, `${suffix}_a`);
    const orderB = await createOrderForUser(userId, `${suffix}_b`);

    const creditA = await insertDynamic("account_credits", {
      user_id: userId,
      amount_cents: 2400,
      remaining_amount_cents: 900,
      reason: "rent_conversion",
      source: "rent_conversion",
      source_type: "rent",
      status: "active",
      created_at: new Date("2026-04-29T10:00:00.000Z"),
      updated_at: new Date("2026-04-29T10:00:00.000Z"),
    });

    const creditB = await insertDynamic("account_credits", {
      user_id: userId,
      amount_cents: 700,
      remaining_amount_cents: 700,
      reason: "manual_adjustment",
      source: "manual_adjustment",
      source_type: "admin",
      status: "active",
      created_at: new Date("2026-04-29T10:01:00.000Z"),
      updated_at: new Date("2026-04-29T10:01:00.000Z"),
    });

    await insertDynamic("account_credit_usages", {
      credit_id: creditA.id,
      user_id: userId,
      order_id: orderA.id,
      amount_cents: 500,
      status: "reserved",
      reason: "checkout_reservation",
      created_at: new Date("2026-04-29T10:02:00.000Z"),
      updated_at: new Date("2026-04-29T10:02:00.000Z"),
    });

    await insertDynamic("account_credit_usages", {
      credit_id: creditA.id,
      user_id: userId,
      order_id: orderA.id,
      amount_cents: 500,
      status: "applied",
      reason: "checkout_completion",
      created_at: new Date("2026-04-29T10:03:00.000Z"),
      updated_at: new Date("2026-04-29T10:03:00.000Z"),
    });

    await insertDynamic("account_credit_usages", {
      credit_id: creditA.id,
      user_id: userId,
      order_id: orderB.id,
      amount_cents: 300,
      status: "released",
      reason: "payment_session_expired",
      created_at: new Date("2026-04-29T10:04:00.000Z"),
      updated_at: new Date("2026-04-29T10:04:00.000Z"),
    });

    await insertDynamic("account_credit_usages", {
      credit_id: creditB.id,
      user_id: userId,
      order_id: orderB.id,
      amount_cents: 200,
      status: "reserved",
      reason: "checkout_reservation",
      created_at: new Date("2026-04-29T10:05:00.000Z"),
      updated_at: new Date("2026-04-29T10:05:00.000Z"),
    });
  });

  afterAll(async () => {
    if (userId) {
      await cleanupUser(userId);
    }

    await closeDbAfterTest(pool);
  });

  it("keeps created and usage rows ordered, unique, and semantically readable", async () => {
    const rows = await listAccountCreditLedger(pool, userId);

    expect(rows.length).toBeGreaterThanOrEqual(6);

    const statuses = rows.map((row) => row.status);

    expect(statuses).toEqual(
      expect.arrayContaining(["created", "reserved", "applied", "released"])
    );

    expect(statuses.filter((status) => status === "created")).toHaveLength(2);

    const createdAmounts = rows
      .filter((row) => row.status === "created")
      .map((row) => Number(row.amount_cents))
      .sort((a, b) => a - b);

    expect(createdAmounts).toEqual([700, 2400]);

    const semanticReasons = rows
      .map((row) => String(row.reason || row.source || row.source_type || ""))
      .join(" ");

    expect(semanticReasons).toMatch(/rent|manual|checkout|payment|session|expired/i);

    const duplicateKeys = new Set();

    for (const row of rows) {
      const key = [
        row.status,
        row.credit_id || "",
        row.usage_id || row.account_credit_usage_id || "",
        row.order_id || "",
        row.amount_cents,
        row.created_at ? new Date(row.created_at).toISOString() : "",
        row.reason || "",
      ].join("|");

      expect(duplicateKeys.has(key)).toBe(false);
      duplicateKeys.add(key);
    }

    const createdAtValues = rows
      .map((row) => row.created_at)
      .filter(Boolean)
      .map((value) => new Date(value).getTime());

    const descending = [...createdAtValues].sort((a, b) => b - a);
    const ascending = [...createdAtValues].sort((a, b) => a - b);

    expect(
      JSON.stringify(createdAtValues) === JSON.stringify(descending) ||
        JSON.stringify(createdAtValues) === JSON.stringify(ascending)
    ).toBe(true);
  });
});
