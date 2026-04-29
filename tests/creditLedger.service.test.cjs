const assert = require("node:assert/strict");

const {
  listAccountCreditLedger,
} = require("../src/modules/finance/creditLedger.service.cjs");

function makeFakeLedgerDb() {
  const calls = [];

  const columns = {
    account_credits: [
      "id",
      "user_id",
      "amount_cents",
      "remaining_amount_cents",
      "status",
      "reason",
      "created_at",
    ],
    account_credit_usages: [
      "id",
      "credit_id",
      "amount_cents",
      "status",
      "reason",
      "order_id",
      "created_at",
    ],
  };

  return {
    calls,

    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/information_schema\.columns/i.test(sql)) {
        const tableName = params[0];

        return {
          rows: (columns[tableName] || []).map((column_name) => ({
            column_name,
          })),
        };
      }

      if (/FROM\s+account_credit_usages\s+u/i.test(sql)) {
        assert.match(
          sql,
          /JOIN\s+account_credits\s+c\s+ON\s+c\.id\s+=\s+u\.credit_id/i,
          "ledger query should join account_credit_usages to account_credits through credit_id"
        );

        assert.match(
          sql,
          /WHERE\s+c\.user_id\s+=\s+\$1/i,
          "ledger query should filter ledger rows by account_credits.user_id"
        );

        assert.deepEqual(
          params,
          [42],
          "ledger query should receive the target user id as the only SQL parameter"
        );

        return {
          rows: [
            {
              credit_id: 10,
              credit_amount_cents: 2000,
              credit_remaining_cents: 0,
              credit_status: "active",
              credit_reason: "rent_conversion",
              credit_created_at: new Date("2026-04-29T10:00:00Z"),
              usage_id: 100,
              credit_relation_id: 10,
              usage_amount_cents: 500,
              usage_status: "reserved",
              usage_reason: "checkout",
              order_id: 9001,
              usage_created_at: new Date("2026-04-29T10:01:00Z"),
            },
            {
              credit_id: 10,
              credit_amount_cents: 2000,
              credit_remaining_cents: 0,
              credit_status: "active",
              credit_reason: "rent_conversion",
              credit_created_at: new Date("2026-04-29T10:00:00Z"),
              usage_id: 101,
              credit_relation_id: 10,
              usage_amount_cents: 1000,
              usage_status: "applied",
              usage_reason: "checkout",
              order_id: 9002,
              usage_created_at: new Date("2026-04-29T10:02:00Z"),
            },
            {
              credit_id: 11,
              credit_amount_cents: 700,
              credit_remaining_cents: 700,
              credit_status: "active",
              credit_reason: "rent_conversion",
              credit_created_at: new Date("2026-04-29T10:03:00Z"),
              usage_id: 102,
              credit_relation_id: 11,
              usage_amount_cents: 700,
              usage_status: "released",
              usage_reason: "checkout_cancelled",
              order_id: 9003,
              usage_created_at: new Date("2026-04-29T10:04:00Z"),
            },
          ],
        };
      }

      throw new Error(`Unexpected SQL in fake ledger db: ${sql}`);
    },
  };
}

describe("creditLedger.service", () => {
  test("builds Finance ledger rows from account credit usage movements", async () => {
    const db = makeFakeLedgerDb();

    const rows = await listAccountCreditLedger(db, 42);

    assert.equal(rows.length, 3);

    assert.deepEqual(
      rows.map((row) => row.status),
      ["reserved", "applied", "released"]
    );

    assert.deepEqual(
      rows.map((row) => row.amount_cents),
      [500, 1000, 700]
    );

    assert.deepEqual(
      rows.map((row) => row.order_id),
      [9001, 9002, 9003]
    );

    assert.equal(rows[0].amount_eur, 5);
    assert.equal(rows[1].amount_eur, 10);
    assert.equal(rows[2].amount_eur, 7);

    assert.ok(
      db.calls.some((call) => call.params[0] === "account_credits"),
      "service should inspect account_credits columns"
    );

    assert.ok(
      db.calls.some((call) => call.params[0] === "account_credit_usages"),
      "service should inspect account_credit_usages columns"
    );
  });

  test("returns an empty ledger for missing user id", async () => {
    const db = makeFakeLedgerDb();

    const rows = await listAccountCreditLedger(db, null);

    assert.deepEqual(rows, []);
    assert.equal(db.calls.length, 0, "service should not query DB without a user id");
  });

  test("includes credit creation rows even before credit usage exists", async () => {
    const calls = [];

    const db = {
      calls,

      async query(sql, params = []) {
        calls.push({ sql, params });

        if (/information_schema\.columns/i.test(sql)) {
          const tableName = params[0];

          const columns = {
            account_credits: [
              "id",
              "user_id",
              "amount_cents",
              "remaining_amount_cents",
              "status",
              "reason",
              "created_at",
            ],
            account_credit_usages: [
              "id",
              "credit_id",
              "amount_cents",
              "status",
              "reason",
              "order_id",
              "created_at",
            ],
          };

          return {
            rows: (columns[tableName] || []).map((column_name) => ({
              column_name,
            })),
          };
        }

        if (/UNION\s+ALL/i.test(sql) && /'created'\s+AS\s+ledger_row_type/i.test(sql)) {
          assert.match(
            sql,
            /FROM\s+account_credits\s+c/i,
            "ledger query should include account_credits creation rows"
          );

          assert.match(
            sql,
            /WHERE\s+c\.user_id\s+=\s+\$1/i,
            "created ledger rows should be filtered by user"
          );

          assert.deepEqual(params, [42]);

          return {
            rows: [
              {
                ledger_row_type: "created",
                credit_id: 20,
                credit_amount_cents: 1500,
                credit_remaining_cents: 1500,
                credit_status: "active",
                credit_reason: "rent_conversion",
                credit_created_at: new Date("2026-04-29T11:00:00Z"),
                usage_id: null,
                credit_relation_id: 20,
                usage_amount_cents: 1500,
                usage_status: "created",
                usage_reason: "rent_conversion",
                order_id: null,
                usage_created_at: new Date("2026-04-29T11:00:00Z"),
                usage_updated_at: null,
                usage_applied_at: null,
                usage_released_at: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected SQL in created-row fake db: ${sql}`);
      },
    };

    const rows = await listAccountCreditLedger(db, 42);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "created");
    assert.equal(rows[0].amount_cents, 1500);
    assert.equal(rows[0].amount_eur, 15);
    assert.equal(rows[0].credit_id, 20);
    assert.equal(rows[0].usage_id, null);
    assert.equal(rows[0].order_id, null);
    assert.equal(rows[0].reason, "rent_conversion");
  });

});
