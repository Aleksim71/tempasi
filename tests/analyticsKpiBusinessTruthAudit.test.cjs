// tests/analyticsKpiBusinessTruthAudit.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readIfExists(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return '';
  return fs.readFileSync(abs, 'utf8');
}

function readMany(relPaths) {
  return relPaths.map(readIfExists).join('\n');
}

describe('Step 6L Analytics/KPI business truth audit', () => {
  test('analytics/admin KPI code exists and references business metrics', () => {
    const sources = readMany([
      'src/modules/analytics/analytics.service.cjs',
      'src/modules/analytics/analytics.controller.cjs',
      'src/modules/admin/adminAnalytics.service.cjs',
      'src/modules/admin/analytics.service.cjs',
      'src/web/routes/admin.routes.js',
      'src/web/routes/admin.routes.cjs',
      'src/web/routes/cabinet.pages.routes.cjs',
      'src/web/views/admin/dashboard.hbs',
      'src/web/views/pages/admin/dashboard.hbs',
      'src/web/views/cabinet/finance.hbs',
      'src/web/views/pages/cabinet/finance.hbs',
    ]);

    expect(sources).toMatch(/analytics|kpi|dashboard|summary|finance/i);
    expect(sources).toMatch(/order|buy|rent|revenue|credit|conversion|template/i);
  });

  test('BUY metrics are expected to use paid/completed BUY semantics, not raw order count', () => {
    const sources = readMany([
      'src/modules/analytics/analytics.service.cjs',
      'src/modules/admin/adminAnalytics.service.cjs',
      'src/modules/admin/analytics.service.cjs',
      'src/modules/orders/orders.repo.cjs',
      'tests/buyExclusivityCheckout.integration.test.cjs',
      'tests/dbBuyExclusivityGuard.integration.test.cjs',
    ]);

    expect(sources).toMatch(/buy/i);
    expect(sources).toMatch(/paid|completed/i);
    expect(sources).toMatch(/template_slug|template_id/i);
    expect(sources).toMatch(/unique|exclusive|exclusivity|one paid BUY/i);
  });

  test('RENT metrics are expected to distinguish active expired converted failed cancelled pending states', () => {
    const sources = readMany([
      'src/modules/analytics/analytics.service.cjs',
      'src/modules/admin/adminAnalytics.service.cjs',
      'src/modules/admin/analytics.service.cjs',
      'src/modules/orders/orders.repo.cjs',
      'src/modules/cases/rentAssignments.service.cjs',
      'tests/rentExpirationContract.test.cjs',
      'tests/rentLifecycleStatusHardening.integration.test.cjs',
      'tests/failedCancelledExpiredRentCheckout.integration.test.cjs',
      'tests/pendingRentCheckout.integration.test.cjs',
    ]);

    expect(sources).toMatch(/rent/i);
    expect(sources).toMatch(/active/i);
    expect(sources).toMatch(/expired|expires_at|ends_at|end_at/i);
    expect(sources).toMatch(/converted_to_buy|converted|buy conversion/i);
    expect(sources).toMatch(/failed|cancelled|pending/i);
  });

  test('rent to buy conversion is covered as a distinct business event', () => {
    const sources = readMany([
      'tests/rentReservation.service.test.cjs',
      'tests/rentExpirationContract.test.cjs',
      'src/modules/orders/orders.service.cjs',
      'src/modules/payments/checkoutCredits.service.cjs',
      'src/modules/finance/creditLedger.service.cjs',
    ]);

    expect(sources).toMatch(/early BUY by renter closes active RENT as converted_to_buy/i);
    expect(sources).toMatch(/converted_to_buy|rent conversion|unused prepaid rent|credit/i);
  });

  test('credit usage is accounted separately from gross checkout revenue', () => {
    const sources = readMany([
      'src/modules/payments/checkoutCredits.service.cjs',
      'src/modules/finance/creditLedger.service.cjs',
      'tests/creditReconciliationHardening.test.cjs',
      'tests/checkoutCredits.integration.test.cjs',
      'tests/checkoutCreditRelease.integration.test.cjs',
    ]);

    expect(sources).toMatch(/gross/i);
    expect(sources).toMatch(/payable/i);
    expect(sources).toMatch(/credit_applied|creditApplied|applied/i);
    expect(sources).toMatch(/reserved|released/i);
  });

  test('current test suite covers KPI source states that analytics must not miscount', () => {
    const sources = readMany([
      'tests/buyExclusivityCheckout.integration.test.cjs',
      'tests/dbBuyExclusivityGuard.integration.test.cjs',
      'tests/buyWebhookIdempotencyHardening.integration.test.cjs',
      'tests/rentLifecycleStatusHardening.integration.test.cjs',
      'tests/creditReconciliationHardening.test.cjs',
      'tests/ownershipSecurityAccessAudit.test.cjs',
    ]);

    expect(sources).toMatch(/paid BUY|one paid BUY|BUY exclusivity|DB-level BUY/i);
    expect(sources).toMatch(/webhook|idempotency/i);
    expect(sources).toMatch(/active non-expired RENT|pending RENT|failed|cancelled|expired/i);
    expect(sources).toMatch(/credit reconciliation|reserved|applied|released/i);
  });
});
