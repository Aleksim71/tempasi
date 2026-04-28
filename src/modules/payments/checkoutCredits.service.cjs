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

  const result = await db.query(
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

async function reserveCreditForOrder(db, { userId, orderId, grossAmountCents }) {
  if (!userId) throw new Error('userId is required');
  if (!orderId) throw new Error('orderId is required');

  const gross = normalizeAmountCents(grossAmountCents);
  if (gross === 0) {
    return { grossAmountCents: 0, creditAppliedCents: 0, payableAmountCents: 0, usages: [] };
  }

  const credits = await db.query(
    `
      SELECT
        c.id,
        c.amount_cents,
        c.created_at,
        COALESCE(SUM(u.amount_cents) FILTER (WHERE u.status IN ('reserved', 'applied')), 0) AS used_cents
      FROM account_credits c
      LEFT JOIN account_credit_usages u ON u.credit_id = c.id
      WHERE c.user_id = $1
        AND c.status = 'active'
        AND (c.expires_at IS NULL OR c.expires_at > now())
      GROUP BY c.id
      HAVING c.amount_cents > COALESCE(SUM(u.amount_cents) FILTER (WHERE u.status IN ('reserved', 'applied')), 0)
      ORDER BY c.expires_at ASC NULLS LAST, c.created_at ASC, c.id ASC
      FOR UPDATE OF c
    `,
    [userId]
  );

  let remaining = gross;
  const usages = [];

  for (const credit of credits.rows || []) {
    if (remaining <= 0) break;

    const available = Math.max(0, toInt(credit.amount_cents, 0) - toInt(credit.used_cents, 0));
    const amount = Math.min(remaining, available);
    if (amount <= 0) continue;

    const inserted = await db.query(
      `
        INSERT INTO account_credit_usages (credit_id, order_id, amount_cents, status)
        VALUES ($1, $2, $3, 'reserved')
        RETURNING id, credit_id, order_id, amount_cents, status
      `,
      [credit.id, orderId, amount]
    );

    usages.push(inserted.rows[0]);
    remaining -= amount;
  }

  const creditAppliedCents = gross - remaining;
  const payableAmountCents = remaining;

  await db.query(
    `
      UPDATE orders
      SET
        gross_amount_cents = $2,
        credit_applied_cents = $3,
        payable_amount_cents = $4
      WHERE id = $1
    `,
    [orderId, gross, creditAppliedCents, payableAmountCents]
  );

  return { grossAmountCents: gross, creditAppliedCents, payableAmountCents, usages };
}

async function applyReservedCreditForOrder(db, orderId) {
  if (!orderId) throw new Error('orderId is required');

  const result = await db.query(
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

  const result = await db.query(
    `
      UPDATE account_credit_usages
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE order_id = $1
        AND status = 'reserved'
      RETURNING id, credit_id, order_id, amount_cents, status
    `,
    [orderId]
  );

  await db.query(
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
