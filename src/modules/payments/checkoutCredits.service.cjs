// path: src/modules/payments/checkoutCredits.service.cjs
'use strict';

/**
 * Tempasi Step 5C — internal credit checkout service.
 *
 * This module keeps credit creation and credit usage separate:
 * - account_credits stores created credit balance;
 * - account_credit_usages stores reserved/applied/released spending rows.
 *
 * Expected DB adapter: pg Pool/Client compatible object with query(sql, params).
 */

function getQueryClient(db) {
  if (db && typeof db.query === 'function') return db;
  if (db && db.pool && typeof db.pool.query === 'function') return db.pool;
  if (db && db.default && typeof db.default.query === 'function') return db.default;
  if (db && db.default && db.default.pool && typeof db.default.pool.query === 'function') {
    return db.default.pool;
  }
  throw new Error('DB_QUERY_NOT_AVAILABLE');
}

async function q(db, sql, params = []) {
  return getQueryClient(db).query(sql, params);
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeAmountCents(value) {
  const amount = toInt(value, 0);
  if (amount < 0) {
    throw new Error('amount_cents must be non-negative');
  }
  return amount;
}

function calculateCheckoutAmounts({ grossAmountCents, availableCreditCents = 0 }) {
  const gross = normalizeAmountCents(grossAmountCents);
  const available = normalizeAmountCents(availableCreditCents);
  const creditAppliedCents = Math.min(gross, available);
  const payableAmountCents = Math.max(0, gross - creditAppliedCents);

  return {
    grossAmountCents: gross,
    creditAppliedCents,
    payableAmountCents,
  };
}

async function getAvailableCreditCents(db, userId) {
  if (!userId) return 0;

  const result = await q(db, 
    `
      SELECT
        COALESCE(SUM(c.amount_cents), 0)
        - COALESCE((
          SELECT SUM(u.amount_cents)
          FROM account_credit_usages u
          JOIN account_credits c2 ON c2.id = u.credit_id
          WHERE c2.user_id = $1
            AND u.status IN ('reserved', 'applied')
        ), 0) AS available_cents
      FROM account_credits c
      WHERE c.user_id = $1
        AND c.status = 'active'
        AND (c.expires_at IS NULL OR c.expires_at > now())
    `,
    [userId]
  );

  return Math.max(0, toInt(result.rows?.[0]?.available_cents, 0));
}

async function reserveCreditForOrder(db, {
  userId,
  orderId,
  grossAmountCents,
} = {}) {
  if (!userId) throw new Error('userId is required');
  if (!orderId) throw new Error('orderId is required');

  const gross = toInt(grossAmountCents, 0);
  if (gross < 0) throw new Error('grossAmountCents must be non-negative');

  const existing = await q(db, `
    SELECT id, credit_id, order_id, amount_cents, status
      FROM account_credit_usages
     WHERE order_id = $1
       AND status = 'reserved'
     ORDER BY id ASC
  `, [orderId]);

  const existingReserved = (existing.rows || []).reduce(
    (sum, row) => sum + toInt(row.amount_cents, 0),
    0,
  );

  if (existingReserved > 0) {
    const amounts = calculateCheckoutAmounts({
      grossAmountCents: gross,
      availableCreditCents: existingReserved,
    });

    await q(db, `
      UPDATE orders
         SET gross_amount_cents = $2,
             credit_applied_cents = $3,
             payable_amount_cents = $4
       WHERE id = $1
    `, [
      orderId,
      amounts.grossAmountCents,
      amounts.creditAppliedCents,
      amounts.payableAmountCents,
    ]);

    return {
      ...amounts,
      usages: existing.rows || [],
    };
  }

  const lockedCredits = await q(db, `
    SELECT id, amount_cents, currency, expires_at, status
      FROM account_credits
     WHERE user_id = $1
       AND status = 'active'
       AND expires_at > now()
     ORDER BY expires_at ASC, id ASC
     FOR UPDATE
  `, [userId]);

  let remainingToApply = gross;
  const usages = [];
  let appliedTotal = 0;

  for (const credit of lockedCredits.rows || []) {
    if (remainingToApply <= 0) break;

    const used = await q(db, `
      SELECT COALESCE(SUM(amount_cents), 0)::int AS used_cents
        FROM account_credit_usages
       WHERE credit_id = $1
         AND status IN ('reserved', 'applied')
    `, [credit.id]);

    const usedCents = toInt(used.rows?.[0]?.used_cents, 0);
    const available = Math.max(0, toInt(credit.amount_cents, 0) - usedCents);
    if (available <= 0) continue;

    const amount = Math.min(available, remainingToApply);
    const inserted = await q(db, `
      INSERT INTO account_credit_usages (credit_id, order_id, amount_cents, status)
      VALUES ($1, $2, $3, 'reserved')
      RETURNING id, credit_id, order_id, amount_cents, status
    `, [credit.id, orderId, amount]);

    if (inserted.rows[0]) {
      usages.push(inserted.rows[0]);
      appliedTotal += amount;
      remainingToApply -= amount;
    }
  }

  const amounts = calculateCheckoutAmounts({
    grossAmountCents: gross,
    availableCreditCents: appliedTotal,
  });

  await q(db, `
    UPDATE orders
       SET gross_amount_cents = $2,
           credit_applied_cents = $3,
           payable_amount_cents = $4
     WHERE id = $1
  `, [
    orderId,
    amounts.grossAmountCents,
    amounts.creditAppliedCents,
    amounts.payableAmountCents,
  ]);

  return {
    ...amounts,
    usages,
  };
}

async function applyReservedCreditForOrder(db, orderId) {
  if (!orderId) throw new Error('orderId is required');

  const result = await q(db, 
    `
      UPDATE account_credit_usages
      SET status = 'applied', applied_at = now(), updated_at = now()
      WHERE order_id = $1
        AND status = 'reserved'
      RETURNING id, credit_id, order_id, amount_cents, status
    `,
    [orderId]
  );

  return result.rows || [];
}

async function releaseReservedCreditForOrder(db, orderId) {
  if (!orderId) throw new Error('orderId is required');

  const result = await q(db, 
    `
      UPDATE account_credit_usages
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE order_id = $1
        AND status = 'reserved'
      RETURNING id, credit_id, order_id, amount_cents, status
    `,
    [orderId]
  );

  await q(db, 
    `
      UPDATE orders
      SET credit_applied_cents = 0,
          payable_amount_cents = COALESCE(gross_amount_cents, payable_amount_cents, 0)
      WHERE id = $1
    `,
    [orderId]
  );

  return result.rows || [];
}

module.exports = {
  calculateCheckoutAmounts,
  getAvailableCreditCents,
  reserveCreditForOrder,
  applyReservedCreditForOrder,
  releaseReservedCreditForOrder,
};
