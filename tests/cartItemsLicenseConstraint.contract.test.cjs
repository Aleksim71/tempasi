// tests/cartItemsLicenseConstraint.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('cart_items license constraint supports explicit RENT duration', () => {
  test('migration allows MVP PU:<days>d license encoding', () => {
    const migrationPath = path.join(
      ROOT,
      'sql/migrations/20260502_0001_cart_items_license_rent_days.sql'
    );

    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('DROP CONSTRAINT IF EXISTS cart_items_license_check');
    expect(sql).toContain('ADD CONSTRAINT cart_items_license_check');
    expect(sql).toContain("license = 'BUY'");
    expect(sql).toContain("license ~ '^PU:[1-9][0-9]*d$'");
  });
});
