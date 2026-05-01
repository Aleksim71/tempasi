'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('template details product-card UX contract', () => {
  test('template details page uses simplified marketplace actions', () => {
    const view = read('src/web/views/pages/template-details.hbs');

    expect(view).toContain('Template summary');
    expect(view).toContain('Actions');

    expect(view).toContain('>Demo<');
    expect(view).toContain('>Buy<');
    expect(view).toContain('>Rent<');
    expect(view).toContain('>← Back<');

    expect(view).not.toContain('Add to cart');
    expect(view).not.toContain('Add rent to cart');
    expect(view).not.toContain('>Download<');
    expect(view).not.toContain('Template info');
  });

  test('Buy and Rent actions keep existing cart flow endpoints', () => {
    const view = read('src/web/views/pages/template-details.hbs');

    expect(view).toContain('action="/cart/add"');
    expect(view).toContain('name="deal_type" value="BUY"');
    expect(view).toContain('name="deal_type" value="RENT"');
    expect(view).not.toContain('action="/api/orders/{{template.slug}}/buy"');
  });
  test('template details page supports public seller profile fields without private login email fallback', () => {
    const view = read('src/web/views/pages/template-details.hbs');
    const route = read('src/web/routes/templates.routes.js');
    const repo = read('src/server/catalog/templates.repo.js');

    expect(repo).toContain('owner_user_id');
    expect(route).toContain('loadPublicSellerProfile');
    expect(route).toContain('FROM user_profiles');
    expect(route).toContain('public_email');
    expect(route).toContain('template.author = await loadPublicSellerProfile');

    expect(view).toContain('Seller');
    expect(view).toContain('{{template.author.name}}');
    expect(view).toContain('@{{template.author.nickname}}');
    expect(view).toContain('{{template.author.bio}}');
    expect(view).toContain('mailto:{{template.author.public_email}}');
    expect(view).toContain('Seller profile is not public yet.');

    expect(route).not.toContain('email AS public_email');
    expect(route).not.toContain('users.email');
  });

});
