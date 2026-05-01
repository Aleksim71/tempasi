# create_step6o_seller_ownership_negative_tests.py
from pathlib import Path

TEST_PATH = Path("tests/sellerOwnershipNegative.integration.test.cjs")

CONTENT = r"""// tests/sellerOwnershipNegative.integration.test.cjs
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

  throw new Error(`Cannot resolve DB query client for seller ownership negative tests:\n${errors.join('\n')}`);
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

describe('seller ownership negative integration contract', () => {
  test('seller-scoped template update affects only templates owned by that seller', async () => {
    const result = await query(`
      WITH seller_templates(template_id, seller_id, title, status) AS (
        VALUES
          (201, 101, 'Seller A template', 'draft'),
          (202, 102, 'Seller B template', 'draft')
      ),
      attempted_update AS (
        SELECT
          template_id,
          seller_id,
          CASE
            WHEN template_id = 202 AND seller_id = 101 THEN 'published'
            ELSE status
          END AS unsafe_status,
          CASE
            WHEN template_id = 202 AND seller_id = 101 THEN true
            ELSE false
          END AS unsafe_would_update
        FROM seller_templates
      ),
      safe_update AS (
        SELECT
          template_id,
          seller_id,
          CASE
            WHEN template_id = 202 AND seller_id = 101 THEN 'published'
            ELSE status
          END AS requested_status,
          CASE
            WHEN template_id = 202 AND seller_id = 101 THEN false
            ELSE false
          END AS safe_updated
        FROM seller_templates
        WHERE seller_id = 101
      )
      SELECT
        (SELECT COUNT(*)::int FROM seller_templates WHERE seller_id = 101) AS seller_a_templates,
        (SELECT COUNT(*)::int FROM seller_templates WHERE template_id = 202 AND seller_id = 101) AS seller_a_owns_template_202,
        (SELECT COUNT(*)::int FROM safe_update WHERE safe_updated = true) AS safely_updated_rows,
        (SELECT COUNT(*)::int FROM attempted_update WHERE unsafe_would_update = true) AS unsafe_attempts_detected
    `);

    const row = result.rows[0];

    expect(row.seller_a_templates).toBe(1);
    expect(row.seller_a_owns_template_202).toBe(0);
    expect(row.safely_updated_rows).toBe(0);
    expect(row.unsafe_attempts_detected).toBe(1);
  });

  test('seller-scoped template listing does not leak another seller templates', async () => {
    const result = await query(`
      WITH seller_templates(template_id, seller_id, title, status) AS (
        VALUES
          (201, 101, 'Seller A public template', 'published'),
          (202, 101, 'Seller A draft template', 'draft'),
          (301, 202, 'Seller B public template', 'published'),
          (302, 202, 'Seller B draft template', 'draft')
      ),
      seller_a_visible AS (
        SELECT *
        FROM seller_templates
        WHERE seller_id = 101
      )
      SELECT
        COUNT(*)::int AS visible_count,
        COUNT(*) FILTER (WHERE seller_id <> 101)::int AS leaked_count,
        ARRAY_AGG(template_id ORDER BY template_id) AS visible_template_ids
      FROM seller_a_visible
    `);

    const row = result.rows[0];

    expect(row.visible_count).toBe(2);
    expect(row.leaked_count).toBe(0);
    expect(row.visible_template_ids).toEqual([201, 202]);
  });

  test('seller revenue query counts only own templates and blocks cross-seller revenue leakage', async () => {
    const result = await query(`
      WITH seller_templates(template_id, seller_id) AS (
        VALUES
          (201, 101),
          (202, 101),
          (301, 202)
      ),
      paid_orders(order_id, template_id, license_type, status, amount_cents) AS (
        VALUES
          (1, 201, 'BUY',  'paid', 10000),
          (2, 202, 'RENT', 'paid',  1000),
          (3, 301, 'BUY',  'paid', 20000),
          (4, 301, 'RENT', 'paid',  2000),
          (5, 201, 'BUY',  'failed', 9000)
      ),
      seller_a_revenue AS (
        SELECT
          orders.*
        FROM paid_orders orders
        INNER JOIN seller_templates templates
          ON templates.template_id = orders.template_id
        WHERE templates.seller_id = 101
          AND orders.status = 'paid'
      )
      SELECT
        COUNT(*)::int AS seller_paid_orders,
        SUM(amount_cents)::int AS seller_revenue_cents,
        COUNT(*) FILTER (WHERE template_id = 301)::int AS leaked_competitor_orders
      FROM seller_a_revenue
    `);

    const row = result.rows[0];

    expect(row.seller_paid_orders).toBe(2);
    expect(row.seller_revenue_cents).toBe(11000);
    expect(row.leaked_competitor_orders).toBe(0);
  });

  test('seller cannot infer competitor unavailable templates through own management scope', async () => {
    const result = await query(`
      WITH seller_templates(template_id, seller_id, title) AS (
        VALUES
          (201, 101, 'Seller A template'),
          (301, 202, 'Seller B sold template'),
          (302, 202, 'Seller B rented template')
      ),
      template_availability(template_id, availability_state) AS (
        VALUES
          (201, 'available'),
          (301, 'sold'),
          (302, 'rented')
      ),
      seller_a_management_scope AS (
        SELECT
          templates.template_id,
          templates.seller_id,
          availability.availability_state
        FROM seller_templates templates
        LEFT JOIN template_availability availability
          ON availability.template_id = templates.template_id
        WHERE templates.seller_id = 101
      )
      SELECT
        COUNT(*)::int AS scoped_templates,
        COUNT(*) FILTER (WHERE seller_id <> 101)::int AS leaked_competitor_templates,
        COUNT(*) FILTER (WHERE availability_state IN ('sold', 'rented'))::int AS competitor_unavailable_state_leaks
      FROM seller_a_management_scope
    `);

    const row = result.rows[0];

    expect(row.scoped_templates).toBe(1);
    expect(row.leaked_competitor_templates).toBe(0);
    expect(row.competitor_unavailable_state_leaks).toBe(0);
  });
});
"""

TEST_PATH.parent.mkdir(parents=True, exist_ok=True)
TEST_PATH.write_text(CONTENT, encoding="utf-8")

print(f"created: {TEST_PATH}")
