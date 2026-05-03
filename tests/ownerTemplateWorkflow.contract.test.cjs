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

describe('owner template workflow contract', () => {
  test('seller_templates schema supports owner hold and permanent withdraw state', () => {
    const migration = read('sql/migrations/20260501_0003_seller_templates_owner_hold_withdraw.sql');

    expect(migration).toContain('owner_hold_until');
    expect(migration).toContain('owner_hold_days');
    expect(migration).toContain('owner_hold_reason');
    expect(migration).toContain('owner_withdrawn_at');
    expect(migration).toContain('owner_withdraw_reason');
  });

  test('public catalog and details hide owner-held and owner-withdrawn templates', () => {
    const repo = compact(read('src/server/catalog/templates.repo.js'));

    expect(repo).toContain('owner_withdrawn_at IS NULL');
    expect(repo).toContain('(owner_hold_until IS NULL OR owner_hold_until <= NOW())');
  });

  test('owner workflow is separated from commercial cart checkout', () => {
    const cart = read('src/web/routes/cart.routes.js');

    expect(cart).toContain('cart=owner_template');
    expect(cart).not.toContain('owner_hold_until');
    expect(cart).not.toContain('owner_withdrawn_at');
  });
  test('owner details page shows owner-only actions instead of commercial Buy/Rent', () => {
    const view = read('src/web/views/pages/template-details.hbs');
    const route = read('src/web/routes/templates.routes.js');

    expect(route).toContain("router.post('/:slug/owner/reserve'");
    expect(route).toContain("router.post('/:slug/owner/withdraw'");
    expect(route).toContain('normalizeOwnerHoldDays');
    expect(route).toContain('owner_hold_until = NOW() + ($2::int * INTERVAL');
    expect(route).toContain('owner_withdrawn_at = NOW()');
    expect(route).toContain('template.isOwner');

    expect(view).toContain('{{#if isOwner}}');
    expect(view).toContain('Edit template');
    expect(view).toContain('Reserve for client');
    expect(view).toContain('Withdraw permanently');
    expect(view).toContain('action="/templates/{{template.slug}}/owner/reserve"');
    expect(view).toContain('action="/templates/{{template.slug}}/owner/withdraw"');
  });

});
