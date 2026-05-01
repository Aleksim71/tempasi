// tests/buyExclusivityRealUi.test.cjs
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Step 6F real sold/unavailable UI behavior', () => {
  test('template details view renders explicit sold/unavailable state', () => {
    const source = read('src/web/views/pages/template-details.hbs');

    expect(source).toContain('TEMPASI_STEP_6F_REAL_UI_SOLD_UNAVAILABLE_BEHAVIOR');
    expect(source).toContain('template.isSold');
    expect(source).toMatch(/Sold/i);
    expect(source).toMatch(/No longer available/i);
  });

  test('template details BUY and RENT CTA are guarded by availability fields', () => {
    const source = read('src/web/views/pages/template-details.hbs');

    expect(source).toContain('template.canBuy');
    expect(source).toContain('template.canRent');
    expect(source).toMatch(/buy-sold-disabled|Sold/i);
    expect(source).toMatch(/rent-sold-disabled|Rent unavailable/i);
  });

  test('templates route imports and applies availability normalizer', () => {
    const source = read('src/web/routes/templates.routes.js');

    expect(source).toContain('templateAvailability.cjs');
    expect(source).toContain('normalizeTemplateAvailability');
    expect(source).toContain('normalizeTemplateListAvailability');
    expect(source).toContain('TEMPASI_STEP_6F_REAL_UI_SOLD_UNAVAILABLE_BEHAVIOR');
  });
});
