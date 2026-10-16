// tests/rentExpirationContract.test.cjs
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function compact(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

describe('rent expiration contract', () => {
  test('catalog hides only active non-expired rent reservations', () => {
    const src = compact(read('src/server/catalog/templates.repo.js'));

    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
    expect(src).toMatch(/deal_type.*RENT/i);
  });

  test('order reservation guard ignores expired rent reservations', () => {
    const src = compact(read('src/modules/orders/orders.repo.cjs'));

    expect(src).toContain('findActiveRentReservationByTemplateSlug');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
  });

  test('case rent assignment lookup requires active non-expired rent', () => {
    const src = compact(read('src/modules/cases/rentAssignments.service.cjs'));

    expect(src).toContain('getActiveRentOrderForUser');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > NOW\(\)/i);
  });

  test('buy conversion closes only active non-expired rent entitlement', () => {
    const src = compact(read('src/modules/payments/repos/entitlements.repo.cjs'));

    expect(src).toContain('closeActiveRentForBuyerBuy');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
  });
});
