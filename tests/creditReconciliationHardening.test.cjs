// tests/creditReconciliationHardening.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Step 6K Finance/credit reconciliation hardening', () => {
  test('credit ledger service exposes all reconciliation movement statuses', () => {
    const source = read('src/modules/finance/creditLedger.service.cjs');

    expect(source).toMatch(/created/i);
    expect(source).toMatch(/reserved/i);
    expect(source).toMatch(/applied/i);
    expect(source).toMatch(/released/i);
  });

  test('credit ledger service tests cover created rows and empty user ledger', () => {
    const source = read('tests/creditLedger.service.test.cjs');

    expect(source).toMatch(/includes credit creation rows/i);
    expect(source).toMatch(/returns an empty ledger for missing user id/i);
    expect(source).toMatch(/reserved/i);
    expect(source).toMatch(/applied/i);
    expect(source).toMatch(/released/i);
  });

  test('credit ledger integration proves created reserved applied released movements from real DB rows', () => {
    const source = read('tests/creditLedger.integration.test.cjs');

    expect(source).toMatch(/created credit/i);
    expect(source).toMatch(/reserved\/applied\/released movements/i);
    expect(source).toMatch(/real DB/i);
  });

  test('credit ledger audit trail keeps rows ordered unique and semantically readable', () => {
    const source = read('tests/creditLedger.auditTrail.test.cjs');

    expect(source).toMatch(/ordered/i);
    expect(source).toMatch(/unique/i);
    expect(source).toMatch(/semantically readable/i);
  });

  test('checkout credit calculation cannot apply more credit than gross amount', () => {
    const source = read('tests/checkoutCredits.service.test.cjs');

    expect(source).toMatch(/never applies credit above gross amount/i);
    expect(source).toMatch(/partial credit/i);
    expect(source).toMatch(/handles no credit/i);
  });

  test('checkout credit integration covers full internal checkout and partial credit application', () => {
    const source = read('tests/checkoutCredits.integration.test.cjs');

    expect(source).toMatch(/active account credit reduces checkout amount/i);
    expect(source).toMatch(/reserved usage to applied/i);
    expect(source).toMatch(/full account credit cover completes checkout internally/i);
    expect(source).toMatch(/without external provider session/i);
  });

  test('checkout credit release tests prove failed/cancelled/expired sessions return reserved value', () => {
    const source = read('tests/checkoutCreditRelease.integration.test.cjs');

    expect(source).toMatch(/reserved checkout credit release/i);
    expect(source).toMatch(/back to available balance/i);
    expect(source).toMatch(/checkout\.session\.expired/i);
    expect(source).toMatch(/async_payment_failed/i);
  });

  test('finance CSV export is hardened against formula injection and anonymous access', () => {
    const source = read('tests/financeCreditLedger.ui.test.cjs');

    expect(source).toMatch(/CSV export escapes risky values/i);
    expect(source).toMatch(/hardened headers/i);
    expect(source).toMatch(/CSV export rejects anonymous access before database lookup/i);
  });

  test('finance ledger UI exposes summary cards and movement labels for reconciliation readability', () => {
    const source = read('tests/financeCreditLedger.ui.test.cjs');

    expect(source).toMatch(/summary cards/i);
    expect(source).toMatch(/movement labels/i);
    expect(source).toMatch(/status pills/i);
  });
});
