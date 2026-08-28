'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ');
}

describe('cart commercial business rules contract', () => {
  test('cart add checks template owner and blocks owner BUY/RENT from commercial checkout', () => {
    const source = read('src/web/routes/cart.routes.js');

    expect(source).toContain('owner_user_id');
    expect(source).toContain('cart=owner_template');
    expect(source).toMatch(/Number\(tpl\.owner_user_id\)/);
    expect(source).toMatch(/Number\(userId\)/);
  });

  test('cart cannot contain BUY and RENT for same template/user at the same time', () => {
    const source = read('src/web/routes/cart.routes.js');
    const flat = compact(source);

    expect(flat).toContain("DELETE FROM cart_items WHERE user_id::text = $1::text AND template_slug = $2 AND UPPER(deal_type) = 'RENT'");
    expect(source).toContain("cart=buy_already_in_cart");
    expect(source).toContain("dealType === 'BUY'");
    expect(source).toContain("dealType === 'RENT'");
  });

  test('RENT requires explicit rent_days and cart view shows reservation duration', () => {
    const source = read('src/web/routes/cart.routes.js');
    const view = read('src/web/views/pages/cart.hbs');

    expect(source).toContain('function normalizeRentDays');
    expect(source).toContain('cart=rent_days_required');
    expect(source).toContain('formatRentDurationLabel');
    expect(source).toContain('rentDays');
    expect(source).toContain('PU:${rentDays}d');

    // Cart groups items into Buy/Rent sections (TEMPASI_CART_BUY_RENT_SPLIT);
    // the Rent section has its own Duration column showing durationLabel.
    expect(view).toContain('cart.rentItems');
    expect(view).toContain('<th>Duration</th>');
    expect(view).toContain('{{durationLabel}}');
  });
});
