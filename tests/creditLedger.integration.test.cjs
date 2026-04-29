const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');
// path: tests/creditLedger.integration.test.cjs
const crypto = require("node:crypto");

const creditLedgerService = require("../src/modules/finance/creditLedger.service.cjs");

const dbModuleCandidates = [
  "../src/config/db.cjs",
  "../src/db.cjs",
  "../src/db/index.cjs",
  "../src/db.js",
  "../src/database.cjs",
  "../src/database/index.cjs",
  "../src/lib/db.cjs",
];

function requireFirstAvailable(paths) {
  const errors = [];

  for (const path of paths) {
    try {
      return require(path);
    } catch (error) {
      errors.push(`${path}: ${error.message}`);
    }
  }

  throw new Error(`Could not load DB module. Tried:\n${errors.join("\n")}`);
}

const dbModule = requireFirstAvailable(dbModuleCandidates);

function resolveQueryClient(moduleValue) {
  const candidates = [
    moduleValue,
    moduleValue && moduleValue.db,
    moduleValue && moduleValue.pool,
    moduleValue && moduleValue.client,
    moduleValue && moduleValue.default,
  ];

  const client = candidates.find((candidate) => candidate && typeof candidate.query === "function");

  if (!client) {
    throw new Error("Loaded DB module, but could not find a query(sql, params) client.");
  }

  return client;
}

const db = resolveQueryClient(dbModule);

async function query(sql, params = []) {
  return db.query(sql, params);
}

function randomUuid() {
  return crypto.randomUUID();
}

function uniqueEmail(prefix) {
  return `${prefix}.${Date.now()}.${Math.random().toString(16).slice(2)}@tempasi.test`;
}

async function tableExists(tableName) {
  const result = await query(
    `
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = $1
      ) as exists
    `,
    [tableName],
  );

  return Boolean(result.rows[0] && result.rows[0].exists);
}

async function getColumns(tableName) {
  const result = await query(
    `
      select
        column_name,
        data_type,
        is_nullable,
        column_default,
        is_generated
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName],
  );

  return result.rows;
}

function hasColumn(columns, name) {
  return columns.some((column) => column.column_name === name);
}

function getColumn(columns, name) {
  return columns.find((column) => column.column_name === name) || null;
}

function pickExistingColumn(columns, names) {
  return names.find((name) => hasColumn(columns, name)) || null;
}

function isUuidColumn(columns, name) {
  const column = getColumn(columns, name);
  return Boolean(column && column.data_type === "uuid");
}

function valueForColumn(column) {
  const name = column.column_name;
  const type = column.data_type;

  if (name === "created_at" || name === "updated_at" || name === "expires_at" || name.endsWith("_at")) {
    return new Date();
  }

  if (name === "email") return uniqueEmail("step5l");
  if (name === "name" || name === "display_name" || name === "full_name") return "Step 5L Test User";
  if (name === "password_hash" || name === "password_digest" || name === "password") return "test-password-hash";
  if (name === "role") return "observer";
  if (name === "status") return "active";
  if (name === "currency") return "EUR";
  if (name === "source") return "step_5l_integration_test";
  if (name === "reason" || name === "description" || name === "note") return "Step 5L finance ledger integration test";

  if (type === "uuid") return randomUuid();
  if (type === "boolean") return false;
  if (type === "integer" || type === "bigint" || type === "smallint") return 0;
  if (type === "numeric" || type === "double precision" || type === "real") return 0;
  if (type.includes("timestamp") || type === "date") return new Date();

  return "step_5l_test";
}

async function insertFlexible(tableName, overrides) {
  const columns = await getColumns(tableName);
  const insertColumns = [];
  const values = [];

  for (const column of columns) {
    const name = column.column_name;
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, name);

    if (hasOverride) {
      insertColumns.push(name);
      values.push(overrides[name]);
      continue;
    }

    const hasDefault = Boolean(column.column_default);
    const nullable = column.is_nullable === "YES";
    const generated = column.is_generated && column.is_generated !== "NEVER";

    if (generated || hasDefault || nullable) {
      continue;
    }

    insertColumns.push(name);
    values.push(valueForColumn(column));
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `
    insert into ${tableName} (${insertColumns.join(", ")})
    values (${placeholders})
    returning *
  `;

  const result = await query(sql, values);
  return result.rows[0];
}

async function ensureTestUser(userId) {
  if (!(await tableExists("users"))) {
    return null;
  }

  const columns = await getColumns("users");

  const overrides = {};

  if (hasColumn(columns, "id") && isUuidColumn(columns, "id")) overrides.id = userId;
  if (hasColumn(columns, "email")) overrides.email = uniqueEmail("step5l.user");
  if (hasColumn(columns, "name")) overrides.name = "Step 5L Test User";
  if (hasColumn(columns, "display_name")) overrides.display_name = "Step 5L Test User";
  if (hasColumn(columns, "password_hash")) overrides.password_hash = "step5l-password-hash";
  if (hasColumn(columns, "role")) overrides.role = "observer";
  if (hasColumn(columns, "status")) overrides.status = "active";
  if (hasColumn(columns, "created_at")) overrides.created_at = new Date();
  if (hasColumn(columns, "updated_at")) overrides.updated_at = new Date();

  return insertFlexible("users", overrides);
}

async function createAccountCredit(userId, amountCents) {
  if (!(await tableExists("account_credits"))) {
    throw new Error("Expected account_credits table to exist for Step 5L integration test.");
  }

  const columns = await getColumns("account_credits");
  const id = randomUuid();

  const overrides = {};

  if (hasColumn(columns, "id") && isUuidColumn(columns, "id")) overrides.id = id;

  const userColumn = pickExistingColumn(columns, ["user_id", "account_user_id", "owner_user_id"]);
  if (userColumn) overrides[userColumn] = userId;

  for (const amountColumn of [
    "amount_cents",
    "initial_amount_cents",
    "original_amount_cents",
    "remaining_amount_cents",
    "available_amount_cents",
    "balance_cents",
  ]) {
    if (hasColumn(columns, amountColumn)) {
      overrides[amountColumn] = amountCents;
    }
  }

  if (hasColumn(columns, "currency")) overrides.currency = "EUR";
  if (hasColumn(columns, "status")) overrides.status = "active";
  if (hasColumn(columns, "source")) overrides.source = "step_5l_integration_test";
  if (hasColumn(columns, "reason")) overrides.reason = "Step 5L created credit";
  if (hasColumn(columns, "description")) overrides.description = "Step 5L created credit";
  if (hasColumn(columns, "created_at")) overrides.created_at = new Date(Date.now() - 60_000);
  if (hasColumn(columns, "updated_at")) overrides.updated_at = new Date(Date.now() - 60_000);

  const inserted = await insertFlexible("account_credits", overrides);

  return {
    row: inserted,
    id: inserted.id || id,
  };
}

async function ensureTestOrder(userId) {
  if (!(await tableExists("orders"))) {
    return null;
  }

  const columns = await getColumns("orders");
  const overrides = {};

  if (hasColumn(columns, "id") && isUuidColumn(columns, "id")) {
    overrides.id = randomUuid();
  }

  const userColumn = pickExistingColumn(columns, [
    "user_id",
    "buyer_id",
    "customer_id",
    "owner_user_id",
    "created_by_user_id",
    "account_user_id",
  ]);

  if (userColumn) {
    overrides[userColumn] = userId;
  }

  if (hasColumn(columns, "status")) overrides.status = "paid";
  if (hasColumn(columns, "payment_status")) overrides.payment_status = "paid";
  if (hasColumn(columns, "currency")) overrides.currency = "EUR";
  if (hasColumn(columns, "total_amount_cents")) overrides.total_amount_cents = 5000;
  if (hasColumn(columns, "amount_cents")) overrides.amount_cents = 5000;
  if (hasColumn(columns, "subtotal_cents")) overrides.subtotal_cents = 5000;
  if (hasColumn(columns, "payable_amount_cents")) overrides.payable_amount_cents = 0;
  if (hasColumn(columns, "provider")) overrides.provider = "internal_credit_zero_pay";
  if (hasColumn(columns, "checkout_source")) overrides.checkout_source = "step_5l_integration_test";
  if (hasColumn(columns, "created_at")) overrides.created_at = new Date(Date.now() - 50_000);
  if (hasColumn(columns, "updated_at")) overrides.updated_at = new Date(Date.now() - 50_000);


  if (hasColumn(columns, "license")) overrides.license = "EX";
  if (hasColumn(columns, "deal_type")) overrides.deal_type = "BUY";

  return insertFlexible("orders", overrides);
}

async function findUsageMovementTable() {
  const candidates = [
    "account_credit_usages",
    "account_credit_usage_movements",
    "account_credit_movements",
    "credit_usage_movements",
    "credit_movements",
  ];

  for (const tableName of candidates) {
    if (await tableExists(tableName)) {
      return tableName;
    }
  }

  return null;
}

async function createCreditMovement(tableName, { userId, creditId, orderId, movementType, amountCents, createdAt }) {
  const columns = await getColumns(tableName);
  const overrides = {};

  if (hasColumn(columns, "id") && isUuidColumn(columns, "id")) overrides.id = randomUuid();

  const userColumn = pickExistingColumn(columns, ["user_id", "account_user_id", "owner_user_id"]);
  if (userColumn) overrides[userColumn] = userId;

  const creditColumn = pickExistingColumn(columns, [
    "account_credit_id",
    "credit_id",
    "source_credit_id",
  ]);
  if (creditColumn) overrides[creditColumn] = creditId;

  const amountColumn = pickExistingColumn(columns, [
    "amount_cents",
    "delta_cents",
    "reserved_amount_cents",
    "applied_amount_cents",
    "released_amount_cents",
  ]);
  if (amountColumn) overrides[amountColumn] = amountCents;

  const typeColumn = pickExistingColumn(columns, [
    "movement_type",
    "type",
    "status",
    "kind",
    "reason",
  ]);
  if (typeColumn) overrides[typeColumn] = movementType;

  if (hasColumn(columns, "order_id") && orderId != null) overrides.order_id = orderId;
  if (hasColumn(columns, "currency")) overrides.currency = "EUR";
  if (hasColumn(columns, "source")) overrides.source = "step_5l_integration_test";
  if (hasColumn(columns, "description")) overrides.description = `Step 5L ${movementType}`;
  if (hasColumn(columns, "created_at")) overrides.created_at = createdAt;
  if (hasColumn(columns, "updated_at")) overrides.updated_at = createdAt;

  return insertFlexible(tableName, overrides);
}

function resolveLedgerLoader() {
  const candidates = [
    "listAccountCreditLedger",
    "getCreditLedger",
    "getCreditLedgerForUser",
    "getFinanceCreditLedger",
    "listCreditLedger",
    "listCreditLedgerForUser",
    "loadCreditLedger",
    "buildCreditLedger",
  ];

  for (const name of candidates) {
    if (typeof creditLedgerService[name] === "function") {
      return creditLedgerService[name];
    }
  }

  if (typeof creditLedgerService === "function") {
    return creditLedgerService;
  }

  throw new Error(
    `Could not find credit ledger loader export. Available exports: ${Object.keys(creditLedgerService).join(", ")}`,
  );
}

async function loadLedgerForUser(userId) {
  const loader = resolveLedgerLoader();

  const attempts = [
    () => loader({ userId, db }),
    () => loader({ userId }),
    () => loader(db, userId),
    () => loader(userId, db),
    () => loader(userId),
  ];

  let lastError;

  for (const attempt of attempts) {
    try {
      const result = await attempt();

      if (Array.isArray(result)) return result;
      if (result && Array.isArray(result.rows)) return result.rows;
      if (result && Array.isArray(result.ledger)) return result.ledger;
      if (result && Array.isArray(result.items)) return result.items;
      if (result && Array.isArray(result.movements)) return result.movements;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Credit ledger loader did not return an array-like result.");
}

async function cleanupUserRows(userId) {
  const tables = [
    "account_credit_usage_movements",
    "account_credit_movements",
    "credit_usage_movements",
    "credit_movements",
    "account_credits",
    "orders",
    "users",
  ];

  for (const tableName of tables) {
    if (!(await tableExists(tableName))) continue;

    const columns = await getColumns(tableName);
    const userColumn = pickExistingColumn(columns, ["user_id", "account_user_id", "owner_user_id", "id"]);

    if (!userColumn) continue;

    try {
      await query(`delete from ${tableName} where ${userColumn} = $1`, [userId]);
    } catch (_) {
      // Cleanup is best-effort because FK direction can differ between schemas.
    }
  }
}

describe("creditLedger real DB integration", () => {
  afterAll(async () => {
    await closeDbAfterTest(dbModule, db);
  });

  test("returns created credit and reserved/applied/released movements from real DB rows", async () => {
    const requestedUserId = randomUuid();
    const user = await ensureTestUser(requestedUserId);
    const userId = user && user.id ? user.id : requestedUserId;

    try {
      const credit = await createAccountCredit(userId, 5000);
      const order = await ensureTestOrder(userId);
      const orderId = order && order.id ? order.id : null;
      const movementTable = await findUsageMovementTable();

      if (!movementTable) {
        throw new Error("Expected a credit usage movement table for Step 5L integration test.");
      }

      await createCreditMovement(movementTable, {
        userId,
        creditId: credit.id,
        orderId,
        movementType: "reserved",
        amountCents: 2000,
        createdAt: new Date(Date.now() - 45_000),
      });

      await createCreditMovement(movementTable, {
        userId,
        creditId: credit.id,
        orderId,
        movementType: "applied",
        amountCents: 1500,
        createdAt: new Date(Date.now() - 30_000),
      });

      await createCreditMovement(movementTable, {
        userId,
        creditId: credit.id,
        orderId,
        movementType: "released",
        amountCents: 500,
        createdAt: new Date(Date.now() - 15_000),
      });

      const ledger = await loadLedgerForUser(userId);
      const serialized = JSON.stringify(ledger).toLowerCase();

      expect(Array.isArray(ledger)).toBe(true);
      expect(ledger.length).toBeGreaterThanOrEqual(4);

      expect(serialized).toMatch(/created|creation|credit/);
      expect(serialized).toContain("reserved");
      expect(serialized).toContain("applied");
      expect(serialized).toContain("released");

      expect(serialized).toMatch(/5000|50\.00|50/);
      expect(serialized).toMatch(/2000|20\.00|20/);
      expect(serialized).toMatch(/1500|15\.00|15/);

      const statuses = ledger.map((row) => String(row.status || "").toLowerCase());

      expect(statuses.filter((status) => status === "created")).toHaveLength(1);
      expect(statuses).toEqual(expect.arrayContaining(["created", "reserved", "applied", "released"]));
    } finally {
      await cleanupUserRows(userId);
    }
  });
});
