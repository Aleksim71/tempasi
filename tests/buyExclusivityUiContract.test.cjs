// tests/buyExclusivityUiContract.test.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Step 6E BUY exclusivity route/UI contract', () => {
  test('service keeps canonical completed BUY guard before checkout creation', () => {
    const source = read('src/modules/orders/orders.service.cjs');

    expect(source).toContain('TEMPASI_STEP_6D_BUY_EXCLUSIVITY_GUARD');
    expect(source).toMatch(/hasPaidBuyByTemplateSlug\s*\(/);
  });

  test('route layer documents safe sold/unavailable checkout behavior', () => {
    const routeSource = read('src/web/routes/checkout.routes.js');
    const serviceSource = read('src/modules/orders/orders.service.cjs');
    const combined = `${routeSource}\n${serviceSource}`;

    expect(combined).toContain('TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT');
    expect(combined).toMatch(/sold|unavailable|conflict|already\s+sold|completed\s+BUY|permanent\s+exclusive/i);
  });

  test('catalog layer documents completed BUY as unavailable for public availability', () => {
    const source = read('src/server/catalog/templates.repo.js');

    expect(source).toContain('TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT');
    expect(source).toMatch(/completed\s+BUY|sold|unavailable|not\s+presented|not\s+available|availability/i);
  });

  test('template details view has explicit sold/no longer available UI contract', () => {
    const source = read('src/web/views/pages/template-details.hbs');

    expect(source).toContain('TEMPASI_STEP_6E_BUY_EXCLUSIVITY_UI_ROUTE_CONTRACT');
    expect(source).toMatch(/Sold|sold|no longer available|unavailable|BUY|RENT/i);
  });
});
