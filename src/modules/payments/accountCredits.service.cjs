'use strict';

// src/modules/payments/accountCredits.service.cjs

const { pool } = require('../../config/db.cjs');

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function calculateUnusedRentCreditCents({
  amountCents,
  startsAt,
  originalEndsAt,
  closedAt,
}) {
  const amount = Number.parseInt(String(amountCents || '0'), 10);
  if (!Number.isInteger(amount) || amount <= 0) return 0;

  const start = toDate(startsAt);
  const originalEnd = toDate(originalEndsAt);
  const closed = toDate(closedAt) || new Date();

  if (!start || !originalEnd) return 0;

  const totalSeconds = Math.max(0, Math.floor((originalEnd.getTime() - start.getTime()) / 1000));
  const remainingSeconds = Math.max(0, Math.floor((originalEnd.getTime() - closed.getTime()) / 1000));

  if (totalSeconds <= 0 || remainingSeconds <= 0) return 0;

  return Math.floor(amount * remainingSeconds / totalSeconds);
}

async function createCreditFromConvertedRent({
  userId,
  rentEntitlement,
  buyOrderId,
}) {
  if (!rentEntitlement) return null;

  const amountCents = calculateUnusedRentCreditCents({
    amountCents: rentEntitlement.rent_amount_cents,
    startsAt: rentEntitlement.original_starts_at || rentEntitlement.starts_at,
    originalEndsAt: rentEntitlement.original_ends_at,
    closedAt: rentEntitlement.closed_at,
  });

  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;

  const sourceOrderId = rentEntitlement.rent_order_id || rentEntitlement.order_id || null;
  const currency = String(rentEntitlement.rent_currency || 'EUR').trim().toUpperCase() || 'EUR';

  const { rows } = await pool.query(
    `
    INSERT INTO public.account_credits (
      user_id,
      source_type,
      source_order_id,
      related_order_id,
      amount_cents,
      currency,
      status,
      expires_at
    )
    VALUES (
      $1,
      'rent_converted_to_buy',
      $2,
      $3,
      $4,
      $5,
      'active',
      now() + interval '90 days'
    )
    ON CONFLICT (source_type, source_order_id, related_order_id) DO NOTHING
    RETURNING *
    `,
    [userId, sourceOrderId, buyOrderId || null, amountCents, currency]
  );

  if (rows[0]) return rows[0];

  const existing = await pool.query(
    `
    SELECT *
    FROM public.account_credits
    WHERE source_type = 'rent_converted_to_buy'
      AND source_order_id = $1
      AND related_order_id = $2
    LIMIT 1
    `,
    [sourceOrderId, buyOrderId || null]
  );

  return existing.rows[0] || null;
}

async function createCreditsFromConvertedRents({
  userId,
  convertedRentEntitlements = [],
  buyOrderId,
}) {
  const credits = [];

  for (const rentEntitlement of convertedRentEntitlements || []) {
    const credit = await createCreditFromConvertedRent({
      userId,
      rentEntitlement,
      buyOrderId,
    });

    if (credit) credits.push(credit);
  }

  return credits;
}

async function getActiveCreditBalance({ userId }) {
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(amount_cents), 0)::int AS amount_cents,
      COALESCE(MAX(currency), 'EUR') AS currency
    FROM public.account_credits
    WHERE user_id = $1
      AND status = 'active'
      AND expires_at > now()
    `,
    [userId]
  );

  return {
    amountCents: Number(rows?.[0]?.amount_cents || 0),
    currency: rows?.[0]?.currency || 'EUR',
  };
}

module.exports = {
  calculateUnusedRentCreditCents,
  createCreditFromConvertedRent,
  createCreditsFromConvertedRents,
  getActiveCreditBalance,
};
