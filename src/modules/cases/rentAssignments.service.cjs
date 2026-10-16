'use strict';

// src/modules/cases/rentAssignments.service.cjs

let getPool;
try {
  ({ getPool } = require('../../../scripts/db.pool.cjs'));
} catch (_e1) {
  try {
    ({ getPool } = require('../../scripts/db.pool.cjs'));
  } catch (e2) {
    throw e2;
  }
}

const casesService = require('./cases.service.cjs');

const LAST_RENT_CASE_ASSIGNMENT_MESSAGE =
  'This active rent must remain assigned to at least one case. Add another case before removing this one.';

function pickDb(db) {
  return db && typeof db.query === 'function' ? db : getPool();
}

function fail(code, status, message = code) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  throw err;
}

async function getActiveRentOrderForUser({ userId, orderId }, db) {
  const pool = pickDb(db);

  const { rows } = await pool.query(
    `
    SELECT
      o.id,
      o.user_id,
      o.template_slug,
      o.deal_type,
      o.status,
      e.id AS entitlement_id,
      e.starts_at,
      e.ends_at
    FROM public.orders o
    JOIN public.entitlements e
      ON e.order_id = o.id
    WHERE o.id = $1
      AND o.user_id::text = $2::text
      AND UPPER(COALESCE(o.deal_type, e.deal_type, '')) = 'RENT'
      AND e.closed_at IS NULL
      AND (e.ends_at IS NULL OR e.ends_at > NOW())
      AND LOWER(COALESCE(o.status, '')) = 'paid'
      AND (e.ends_at IS NULL OR e.ends_at > now())
    LIMIT 1
    `,
    [orderId, String(userId)]
  );

  return rows[0] || null;
}

async function assertOwnedCase({ userId, caseId }, db) {
  const owned = await casesService.listOwnedCaseIds(userId, [caseId], db);
  if (!owned.includes(String(caseId))) {
    fail('RENT_CASE_NOT_OWNED', 403, 'Selected Case does not belong to current user.');
  }
}

async function listAssignments(orderId, db) {
  const pool = pickDb(db);

  const { rows } = await pool.query(
    `
    SELECT case_id
    FROM public.order_case_assignments
    WHERE order_id = $1
    ORDER BY created_at ASC, case_id ASC
    `,
    [orderId]
  );

  return (rows || []).map((row) => String(row.case_id));
}

async function addAssignment({ userId, orderId, caseId }, db) {
  const pool = pickDb(db);
  const normalizedCaseId = String(caseId || '').trim();

  if (!normalizedCaseId) {
    fail('RENT_CASE_ID_REQUIRED', 400, 'Select a Case.');
  }

  const activeRent = await getActiveRentOrderForUser({ userId, orderId }, pool);
  if (!activeRent) {
    fail('ACTIVE_RENT_NOT_FOUND', 404, 'Active RENT reservation was not found.');
  }

  await assertOwnedCase({ userId, caseId: normalizedCaseId }, pool);

  const { rows } = await pool.query(
    `
    INSERT INTO public.order_case_assignments(order_id, case_id)
    VALUES ($1, $2)
    ON CONFLICT (order_id, case_id) DO NOTHING
    RETURNING *
    `,
    [orderId, normalizedCaseId]
  );

  return rows[0] || null;
}

async function removeAssignment({ userId, orderId, caseId }, db) {
  const pool = pickDb(db);
  const normalizedCaseId = String(caseId || '').trim();

  if (!normalizedCaseId) {
    fail('RENT_CASE_ID_REQUIRED', 400, 'Select a Case.');
  }

  const activeRent = await getActiveRentOrderForUser({ userId, orderId }, pool);
  if (!activeRent) {
    fail('ACTIVE_RENT_NOT_FOUND', 404, 'Active RENT reservation was not found.');
  }

  await assertOwnedCase({ userId, caseId: normalizedCaseId }, pool);

  const assignments = await listAssignments(orderId, pool);
  if (assignments.length <= 1 && assignments.includes(normalizedCaseId)) {
    fail('LAST_RENT_CASE_ASSIGNMENT_BLOCKED', 409, LAST_RENT_CASE_ASSIGNMENT_MESSAGE);
  }

  const { rows } = await pool.query(
    `
    DELETE FROM public.order_case_assignments
    WHERE order_id = $1
      AND case_id = $2
    RETURNING *
    `,
    [orderId, normalizedCaseId]
  );

  return rows[0] || null;
}

module.exports = {
  LAST_RENT_CASE_ASSIGNMENT_MESSAGE,
  getActiveRentOrderForUser,
  listAssignments,
  addAssignment,
  removeAssignment,
};
