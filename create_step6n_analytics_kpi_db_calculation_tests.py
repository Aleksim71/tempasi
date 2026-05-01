# create_step6n_analytics_kpi_db_calculation_tests.py
from pathlib import Path

TEST_PATH = Path("tests/analyticsKpiDbCalculations.integration.test.cjs")

CONTENT = r"""// tests/analyticsKpiDbCalculations.integration.test.cjs
'use strict';

const path = require('path');

function loadDb() {
  const candidates = [
    '../src/config/db.cjs',
    '../src/db/pool.cjs',
    '../scripts/db.pool.cjs',
    '../src/db/index.cjs',
  ];

  const errors = [];

  for (const rel of candidates) {
    try {
      const mod = require(path.join(__dirname, rel));
      if (mod && typeof mod.query === 'function') return mod;
      if (mod && mod.pool && typeof mod.pool.query === 'function') return mod.pool;
      if (mod && mod.default && typeof mod.default.query === 'function') return mod.default;
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
    }
  }

  throw new Error(`Cannot resolve DB query client for analytics KPI tests:\n${errors.join('\n')}`);
}

const db = loadDb();

async function query(sql, params = []) {
  return db.query(sql, params);
}

async function closeDb() {
  const closeCandidates = [
    db.end,
    db.close,
    db.pool && db.pool.end,
    db.pool && db.pool.close,
  ].filter(Boolean);

  for (const close of closeCandidates) {
    try {
      await close.call(db.pool || db);
      return;
    } catch (_) {
      // Some shared test pools are closed by their own lifecycle.
    }
  }
}

afterAll(async () => {
  await closeDb();
});

describe('analytics KPI DB calculation contract', () => {
  test('calculates paid BUY/RENT monthly revenue, order counts, and rent-to-buy conversion in SQL', async () => {
    const result = await query(`
      WITH orders(order_id, user_id, template_id, license_type, status, amount_cents, paid_at) AS (
        VALUES
          (1, 101, 201, 'RENT', 'paid', 1000, TIMESTAMPTZ '2026-04-01 10:00:00+00'),
          (2, 101, 201, 'BUY',  'paid', 9000, TIMESTAMPTZ '2026-04-02 10:00:00+00'),
          (3, 102, 202, 'RENT', 'paid', 1200, TIMESTAMPTZ '2026-04-03 10:00:00+00'),
          (4, 103, 203, 'BUY',  'paid', 8000, TIMESTAMPTZ '2026-04-04 10:00:00+00'),

          -- These rows must not affect paid KPI truth:
          (5, 104, 204, 'RENT', 'pending',   1400, TIMESTAMPTZ '2026-04-05 10:00:00+00'),
          (6, 105, 205, 'BUY',  'failed',    7000, TIMESTAMPTZ '2026-04-06 10:00:00+00'),
          (7, 106, 206, 'RENT', 'cancelled', 1300, TIMESTAMPTZ '2026-04-07 10:00:00+00')
      ),
      paid_orders AS (
        SELECT *
        FROM orders
        WHERE status = 'paid'
      ),
      rent_orders AS (
        SELECT *
        FROM paid_orders
        WHERE license_type = 'RENT'
      ),
      converted_rents AS (
        SELECT DISTINCT rent_orders.order_id
        FROM rent_orders
        WHERE EXISTS (
          SELECT 1
          FROM paid_orders buy_orders
          WHERE buy_orders.license_type = 'BUY'
            AND buy_orders.user_id = rent_orders.user_id
            AND buy_orders.template_id = rent_orders.template_id
            AND buy_orders.paid_at > rent_orders.paid_at
        )
      )
      SELECT
        DATE_TRUNC('month', paid_orders.paid_at)::date AS month,
        COUNT(*) FILTER (WHERE paid_orders.license_type = 'BUY')::int AS paid_buy_orders,
        COUNT(*) FILTER (WHERE paid_orders.license_type = 'RENT')::int AS paid_rent_orders,
        SUM(paid_orders.amount_cents)::int AS gross_revenue_cents,
        SUM(paid_orders.amount_cents) FILTER (WHERE paid_orders.license_type = 'BUY')::int AS buy_revenue_cents,
        SUM(paid_orders.amount_cents) FILTER (WHERE paid_orders.license_type = 'RENT')::int AS rent_revenue_cents,
        COUNT(DISTINCT paid_orders.user_id)::int AS paying_users,
        COUNT(DISTINCT converted_rents.order_id)::int AS converted_rent_orders,
        ROUND(
          100.0 * COUNT(DISTINCT converted_rents.order_id)
          / NULLIF(COUNT(*) FILTER (WHERE paid_orders.license_type = 'RENT'), 0),
          2
        )::numeric AS rent_to_buy_conversion_percent
      FROM paid_orders
      LEFT JOIN converted_rents ON converted_rents.order_id = paid_orders.order_id
      GROUP BY 1
    `);

    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];

    expect(String(row.month)).toContain('2026-04');
    expect(row.paid_buy_orders).toBe(2);
    expect(row.paid_rent_orders).toBe(2);
    expect(row.gross_revenue_cents).toBe(19200);
    expect(row.buy_revenue_cents).toBe(17000);
    expect(row.rent_revenue_cents).toBe(2200);
    expect(row.paying_users).toBe(3);
    expect(row.converted_rent_orders).toBe(1);
    expect(Number(row.rent_to_buy_conversion_percent)).toBe(50);
  });

  test('calculates MAU, LTV, CAC, and average rent hold duration in SQL without inventing business data', async () => {
    const result = await query(`
      WITH activity_events(user_id, occurred_at) AS (
        VALUES
          (101, TIMESTAMPTZ '2026-04-01 10:00:00+00'),
          (101, TIMESTAMPTZ '2026-04-02 10:00:00+00'),
          (102, TIMESTAMPTZ '2026-04-03 10:00:00+00'),
          (103, TIMESTAMPTZ '2026-04-04 10:00:00+00'),
          (103, TIMESTAMPTZ '2026-05-01 10:00:00+00')
      ),
      paid_orders(user_id, amount_cents, status, paid_at) AS (
        VALUES
          (101, 10000, 'paid', TIMESTAMPTZ '2026-04-01 10:00:00+00'),
          (101,  2000, 'paid', TIMESTAMPTZ '2026-04-02 10:00:00+00'),
          (102,  8000, 'paid', TIMESTAMPTZ '2026-04-03 10:00:00+00'),
          (104,  9000, 'failed', TIMESTAMPTZ '2026-04-04 10:00:00+00')
      ),
      marketing_spend(month, spend_cents) AS (
        VALUES
          (DATE '2026-04-01', 6000)
      ),
      new_customers(month, user_id) AS (
        VALUES
          (DATE '2026-04-01', 101),
          (DATE '2026-04-01', 102),
          (DATE '2026-04-01', 103)
      ),
      rent_holds(template_id, user_id, started_at, finished_at) AS (
        VALUES
          (201, 101, TIMESTAMPTZ '2026-04-01 00:00:00+00', TIMESTAMPTZ '2026-04-02 00:00:00+00'),
          (202, 102, TIMESTAMPTZ '2026-04-03 00:00:00+00', TIMESTAMPTZ '2026-04-05 00:00:00+00')
      ),
      monthly_mau AS (
        SELECT
          DATE_TRUNC('month', occurred_at)::date AS month,
          COUNT(DISTINCT user_id)::int AS mau
        FROM activity_events
        GROUP BY 1
      ),
      monthly_ltv AS (
        SELECT
          DATE_TRUNC('month', paid_at)::date AS month,
          ROUND(
            SUM(amount_cents)::numeric / NULLIF(COUNT(DISTINCT user_id), 0),
            2
          ) AS ltv_cents
        FROM paid_orders
        WHERE status = 'paid'
        GROUP BY 1
      ),
      monthly_cac AS (
        SELECT
          marketing_spend.month,
          ROUND(
            marketing_spend.spend_cents::numeric / NULLIF(COUNT(DISTINCT new_customers.user_id), 0),
            2
          ) AS cac_cents
        FROM marketing_spend
        LEFT JOIN new_customers ON new_customers.month = marketing_spend.month
        GROUP BY marketing_spend.month, marketing_spend.spend_cents
      ),
      monthly_rent_duration AS (
        SELECT
          DATE_TRUNC('month', started_at)::date AS month,
          ROUND(AVG(EXTRACT(EPOCH FROM finished_at - started_at) / 3600.0), 2) AS average_rent_hold_hours
        FROM rent_holds
        GROUP BY 1
      )
      SELECT
        monthly_mau.month,
        monthly_mau.mau,
        monthly_ltv.ltv_cents,
        monthly_cac.cac_cents,
        monthly_rent_duration.average_rent_hold_hours
      FROM monthly_mau
      LEFT JOIN monthly_ltv ON monthly_ltv.month = monthly_mau.month
      LEFT JOIN monthly_cac ON monthly_cac.month = monthly_mau.month
      LEFT JOIN monthly_rent_duration ON monthly_rent_duration.month = monthly_mau.month
      WHERE monthly_mau.month = DATE '2026-04-01'
    `);

    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];

    expect(row.mau).toBe(3);
    expect(Number(row.ltv_cents)).toBe(10000);
    expect(Number(row.cac_cents)).toBe(2000);
    expect(Number(row.average_rent_hold_hours)).toBe(36);
  });

  test('keeps unavailable states out of revenue KPIs but visible for operational funnel counts', async () => {
    const result = await query(`
      WITH checkout_events(order_id, license_type, status, amount_cents) AS (
        VALUES
          (1, 'BUY',  'paid',      10000),
          (2, 'RENT', 'paid',       1000),
          (3, 'BUY',  'pending',    9000),
          (4, 'RENT', 'failed',     1200),
          (5, 'RENT', 'cancelled',  1200),
          (6, 'RENT', 'expired',    1200)
      )
      SELECT
        COUNT(*)::int AS checkout_attempts,
        COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_orders,
        COUNT(*) FILTER (WHERE status IN ('pending', 'failed', 'cancelled', 'expired'))::int AS non_revenue_events,
        COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::int AS recognized_revenue_cents,
        COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'paid'), 0)::int AS excluded_from_revenue_cents
      FROM checkout_events
    `);

    const row = result.rows[0];

    expect(row.checkout_attempts).toBe(6);
    expect(row.paid_orders).toBe(2);
    expect(row.non_revenue_events).toBe(4);
    expect(row.recognized_revenue_cents).toBe(11000);
    expect(row.excluded_from_revenue_cents).toBe(12600);
  });
});
"""

TEST_PATH.parent.mkdir(parents=True, exist_ok=True)
TEST_PATH.write_text(CONTENT, encoding="utf-8")

print(f"created: {TEST_PATH}")
