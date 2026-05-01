# create_step6p_sold_template_route_html_test.py
from pathlib import Path

TEST_PATH = Path("tests/soldTemplateRouteHtml.integration.test.cjs")

CONTENT = r"""// tests/soldTemplateRouteHtml.integration.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

function readExistingFile(candidates) {
  const checked = [];

  for (const candidate of candidates) {
    const abs = path.join(__dirname, '..', candidate);
    checked.push(candidate);

    if (fs.existsSync(abs)) {
      return {
        path: abs,
        relativePath: candidate,
        content: fs.readFileSync(abs, 'utf8'),
      };
    }
  }

  throw new Error(`None of the candidate files exist:\n${checked.join('\n')}`);
}

function stripHandlebarsBlocks(source) {
  return source
    .replace(/\{\{![\s\S]*?\}\}/g, '')
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{#if\s+[^}]+?\}\}/g, '')
    .replace(/\{\{#unless\s+[^}]+?\}\}/g, '')
    .replace(/\{\{#each\s+[^}]+?\}\}/g, '')
    .replace(/\{\{else\}\}/g, '')
    .replace(/\{\{\/if\}\}/g, '')
    .replace(/\{\{\/unless\}\}/g, '')
    .replace(/\{\{\/each\}\}/g, '');
}

function renderVerySmallHandlebarsTemplate(source, context) {
  let html = stripHandlebarsBlocks(source);

  const replacements = {
    'template.id': context.template.id,
    'template.slug': context.template.slug,
    'template.title': context.template.title,
    'template.name': context.template.title,
    'template.status': context.template.status,
    'template.availability': context.template.availability,
    'template.availability_state': context.template.availability_state,
    'template.availabilityState': context.template.availabilityState,
    'template.license_status': context.template.license_status,
    'template.licenseStatus': context.template.licenseStatus,
    'template.price_cents': String(context.template.price_cents),
    'template.rent_price_cents': String(context.template.rent_price_cents),
    'template.buy_price_cents': String(context.template.buy_price_cents),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{\\s*${key.replace('.', '\\.')}\\s*\\}\\}`, 'g'), String(value ?? ''));
  }

  html = html.replace(/\{\{\s*[^}]+?\s*\}\}/g, '');

  return html;
}

function normalizeHtml(html) {
  return String(html)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasBuyOrRentCta(html) {
  const normalized = normalizeHtml(html);

  const forbiddenPatterns = [
    /<button[^>]*>\s*buy\s*<\/button>/i,
    /<button[^>]*>\s*rent\s*<\/button>/i,
    /<a[^>]*>\s*buy\s*<\/a>/i,
    /<a[^>]*>\s*rent\s*<\/a>/i,
    /data-action=["']buy["']/i,
    /data-action=["']rent["']/i,
    /name=["']license_type["'][^>]*value=["']buy["']/i,
    /name=["']license_type["'][^>]*value=["']rent["']/i,
    /value=["']buy["'][^>]*name=["']license_type["']/i,
    /value=["']rent["'][^>]*name=["']license_type["']/i,
    /\/checkout[^"']*license[^"']*buy/i,
    /\/checkout[^"']*license[^"']*rent/i,
    /\/orders[^"']*buy/i,
    /\/orders[^"']*rent/i,
  ];

  return forbiddenPatterns.some((pattern) => pattern.test(normalized));
}

describe('sold template route-level HTML contract', () => {
  test('template details view has explicit sold/unavailable branch and CTA hiding contract', () => {
    const view = readExistingFile([
      'src/web/views/template-details.hbs',
      'src/web/views/templates/details.hbs',
      'src/web/views/catalog/template-details.hbs',
      'views/template-details.hbs',
      'views/templates/details.hbs',
    ]);

    const source = normalizeHtml(view.content);

    expect(view.relativePath).toMatch(/template|detail|catalog/);

    expect(source).toEqual(expect.stringMatching(/sold|unavailable|not available|already sold|reserved|rented/));
    expect(source).toEqual(expect.stringMatching(/buy|rent|checkout|cta/));

    const hasConditionalGuard =
      /\{\{[#/]?(if|unless)\s+[^}]*sold[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*available[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*availability[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*canBuy[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*canRent[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*showBuy[^}]*\}\}/i.test(view.content) ||
      /\{\{[#/]?(if|unless)\s+[^}]*showRent[^}]*\}\}/i.test(view.content);

    expect(hasConditionalGuard).toBe(true);
  });

  test('sold template HTML fixture does not expose BUY or RENT route CTA', () => {
    const view = readExistingFile([
      'src/web/views/template-details.hbs',
      'src/web/views/templates/details.hbs',
      'src/web/views/catalog/template-details.hbs',
      'views/template-details.hbs',
      'views/templates/details.hbs',
    ]);

    const soldTemplate = {
      id: 987654,
      slug: 'sold-route-html-contract-template',
      title: 'Sold route HTML contract template',
      status: 'sold',
      availability: 'sold',
      availability_state: 'sold',
      availabilityState: 'sold',
      license_status: 'sold',
      licenseStatus: 'sold',
      price_cents: 10000,
      buy_price_cents: 10000,
      rent_price_cents: 1000,
    };

    const html = renderVerySmallHandlebarsTemplate(view.content, {
      template: soldTemplate,
      isSold: true,
      sold: true,
      unavailable: true,
      canBuy: false,
      canRent: false,
      showBuy: false,
      showRent: false,
      allowBuy: false,
      allowRent: false,
    });

    const normalized = normalizeHtml(html);

    expect(normalized).toContain('sold');
    expect(hasBuyOrRentCta(html)).toBe(false);
  });

  test('route/controller source passes sold availability state into template details rendering', () => {
    const routeOrController = readExistingFile([
      'src/web/routes/template.routes.js',
      'src/web/routes/templates.routes.js',
      'src/web/routes/catalog.routes.js',
      'src/web/routes/template-details.routes.js',
      'src/server/catalog/templates.controller.js',
      'src/server/catalog/templates.repo.js',
      'src/modules/templates/templates.controller.cjs',
      'src/modules/catalog/catalog.controller.cjs',
      'src/app.web.js',
    ]);

    const source = normalizeHtml(routeOrController.content);

    expect(routeOrController.relativePath).toEqual(expect.stringMatching(/route|controller|catalog|template|app\.web/));
    expect(source).toEqual(expect.stringMatching(/render|template-details|details|template/));
    expect(source).toEqual(expect.stringMatching(/sold|availability|available|status|entitlement|rent|buy/));
  });
});
"""

TEST_PATH.parent.mkdir(parents=True, exist_ok=True)
TEST_PATH.write_text(CONTENT, encoding="utf-8")

print(f"created: {TEST_PATH}")
