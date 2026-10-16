// tests/templateAvailability.helper.test.cjs
const {
  normalizeTemplateAvailability,
  normalizeTemplateListAvailability,
} = require('../src/web/helpers/templateAvailability.cjs');

describe('templateAvailability helper', () => {
  test('marks completed BUY templates as sold and disables BUY/RENT CTA', () => {
    const template = normalizeTemplateAvailability({
      slug: 'exclusive-template',
      hasCompletedBuy: true,
      rentEnabled: true,
      buyEnabled: true,
    });

    expect(template.isSold).toBe(true);
    expect(template.is_sold).toBe(true);
    expect(template.availabilityStatus).toBe('sold');
    expect(template.availabilityLabel).toMatch(/sold|no longer available/i);
    expect(template.canBuy).toBe(false);
    expect(template.canRent).toBe(false);
  });

  test('keeps available templates buyable and rentable by default', () => {
    const template = normalizeTemplateAvailability({
      slug: 'available-template',
    });

    expect(template.isSold).toBe(false);
    expect(template.canBuy).toBe(true);
    expect(template.canRent).toBe(true);
  });

  test('normalizes template lists', () => {
    const templates = normalizeTemplateListAvailability([
      { slug: 'a' },
      { slug: 'b', availability: 'sold' },
    ]);

    expect(templates).toHaveLength(2);
    expect(templates[0].canBuy).toBe(true);
    expect(templates[1].canBuy).toBe(false);
    expect(templates[1].canRent).toBe(false);
  });
});
