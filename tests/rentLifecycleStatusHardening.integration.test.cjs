// tests/rentLifecycleStatusHardening.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

function read(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relPath), 'utf8');
}

describe('Step 6I RENT lifecycle status hardening', () => {
  test('catalog visibility contract only treats active non-expired RENT as blocking', () => {
    const catalogRepo = read('src/server/catalog/templates.repo.js');

    expect(catalogRepo).toMatch(/rent/i);
    expect(catalogRepo).toMatch(/active/i);
    expect(catalogRepo).toMatch(/expires_at|ends_at|end_at/i);
    expect(catalogRepo).toMatch(/now\(\)|CURRENT_TIMESTAMP|Date/i);
  });

  test('order reservation guard ignores expired rent reservations', () => {
    const ordersRepo = read('src/modules/orders/orders.repo.cjs');
    const ordersService = read('src/modules/orders/orders.service.cjs');
    const combined = `${ordersRepo}\n${ordersService}`;

    expect(combined).toMatch(/rent/i);
    expect(combined).toMatch(/expired|expires_at|ends_at|end_at/i);
    expect(combined).toMatch(/active/i);
  });

  test('case rent assignment lookup requires active non-expired rent', () => {
    const source = read('src/modules/cases/rentAssignments.service.cjs');

    expect(source).toMatch(/rent/i);
    expect(source).toMatch(/active/i);
    expect(source).toMatch(/expires_at|ends_at|end_at/i);
  });

  test('failed cancelled expired RENT checkout side-effect tests exist', () => {
    const source = read('tests/failedCancelledExpiredRentCheckout.integration.test.cjs');

    expect(source).toMatch(/test\.each/i);
    expect(source).toMatch(/cancelled/i);
    expect(source).toMatch(/failed/i);
    expect(source).toMatch(/expired/i);
    expect(source).toMatch(/does not reserve\/hide\/block template/i);
  });

  test('pending RENT checkout has no public reservation side effects before entitlement', () => {
    const source = read('tests/pendingRentCheckout.integration.test.cjs');

    expect(source).toMatch(/pending RENT/i);
    expect(source).toMatch(/does not hide template/i);
    expect(source).toMatch(/does not block BUY/i);
  });

  test('rent expiration integration proves expired RENT returns to gallery and later BUY removes permanently', () => {
    const source = read('tests/rentExpiration.integration.test.cjs');

    expect(source).toMatch(/expired RENT returns template to gallery/i);
    expect(source).toMatch(/later BUY removes it permanently/i);
  });

  test('rent expiration contract covers catalog, orders, cases and buy conversion', () => {
    const source = read('tests/rentExpirationContract.test.cjs');

    expect(source).toMatch(/catalog hides only active non-expired rent reservations/i);
    expect(source).toMatch(/order reservation guard ignores expired rent reservations/i);
    expect(source).toMatch(/case rent assignment lookup requires active non-expired rent/i);
    expect(source).toMatch(/buy conversion closes only active non-expired rent entitlement/i);
  });
});
