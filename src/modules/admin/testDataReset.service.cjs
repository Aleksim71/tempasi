/* eslint-env node */
'use strict';

// src/modules/admin/testDataReset.service.cjs
//
// TEMPASI_ADMIN_RESET_TEST_DATA (2026-08-13)
//
// Wipes all transactional/statistics data accumulated while the
// catalog is still 100% test templates: orders, entitlements, cart
// holds, the account-credit ledger, and the admin audit log itself.
//
// Deliberately NOT touched: users, seller_templates. A template's
// "sold" / "rent-held" status is never stored as a column — it's
// always computed on the fly from NOT EXISTS checks against
// orders/entitlements/cart_items (see templates.repo.js) — so wiping
// those tables alone is enough to un-sell/un-hold every template.
// Nothing else needs to be touched for that to take effect.
//
// This is a genuinely destructive, irreversible operation. The admin
// UI gates it behind a typed "RESET" confirmation prompt; this
// function itself does not re-confirm anything — by the time it's
// called, the decision has already been made.

async function resetTestStatistics({ pool, actorUserId }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error('DB_POOL_REQUIRED');
  }

  const client = await pool.connect();
  const counts = {
    accountCreditUsages: 0,
    cartItems: 0,
    entitlements: 0,
    orders: 0,
    accountCredits: 0,
    adminAuditLog: 0,
  };

  try {
    await client.query('BEGIN');

    // Delete order: respects FK constraints without relying on
    // cascade for anything we want an exact count for.
    // account_credit_usages.credit_id -> account_credits ON DELETE RESTRICT,
    // so usages must go first.
    counts.accountCreditUsages = (await client.query('DELETE FROM account_credit_usages')).rowCount || 0;
    counts.cartItems = (await client.query('DELETE FROM cart_items')).rowCount || 0;
    counts.entitlements = (await client.query('DELETE FROM entitlements')).rowCount || 0;
    // order_case_assignments has ON DELETE CASCADE on order_id, so it
    // cleans up automatically here.
    counts.orders = (await client.query('DELETE FROM orders')).rowCount || 0;
    counts.accountCredits = (await client.query('DELETE FROM account_credits')).rowCount || 0;
    counts.adminAuditLog = (await client.query('DELETE FROM admin_audit_log')).rowCount || 0;

    // Log the reset itself — the one entry that survives it, so
    // there's still a record of who did this and when even though
    // everything before it is gone.
    await client.query(
      `INSERT INTO admin_audit_log (actor_user_id, action, target_type, target_id, meta)
       VALUES ($1, 'test_data_reset', 'platform', NULL, $2::jsonb)`,
      [actorUserId || null, JSON.stringify({ counts })],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return { counts };
}

module.exports = { resetTestStatistics };
