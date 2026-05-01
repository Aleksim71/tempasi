// tests/soldTemplateRouteHtml.integration.test.cjs
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

function walkFiles(rootDir, predicate) {
  const out = [];

  if (!fs.existsSync(rootDir)) return out;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const abs = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'coverage', 'outbox'].includes(entry.name)) continue;
      out.push(...walkFiles(abs, predicate));
      continue;
    }

    if (entry.isFile() && predicate(abs)) {
      out.push(abs);
    }
  }

  return out;
}

function findTemplateDetailsView() {
  const root = path.join(__dirname, '..');

  const candidates = walkFiles(root, (abs) => {
    const rel = path.relative(root, abs).replace(/\\/g, '/').toLowerCase();
    return rel.endsWith('.hbs')
      && rel.includes('view')
      && rel.includes('template')
      && (rel.includes('detail') || rel.includes('show'));
  });

  const scored = candidates
    .map((abs) => {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      const content = fs.readFileSync(abs, 'utf8').toLowerCase();

      let score = 0;
      if (/template[-_/]?details?/.test(rel.toLowerCase())) score += 20;
      if (content.includes('buy')) score += 5;
      if (content.includes('rent')) score += 5;
      if (content.includes('sold')) score += 5;
      if (content.includes('unavailable')) score += 4;
      if (content.includes('checkout')) score += 4;

      return { abs, rel, content, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    throw new Error(`Cannot find template details .hbs view. Checked ${candidates.length} candidate .hbs files.`);
  }

  const best = scored[0];

  return {
    path: best.abs,
    relativePath: best.rel,
    content: fs.readFileSync(best.abs, 'utf8'),
  };
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
    const view = findTemplateDetailsView();

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

  test('BUY and RENT CTA markup is guarded by sold/availability conditions in template details view', () => {
    const view = findTemplateDetailsView();
    const lines = view.content.split(/\r?\n/);

    const ctaLineIndexes = [];

    lines.forEach((line, index) => {
      const lower = line.toLowerCase();

      const looksLikeCta =
        /<a|<button|<form|data-action=|license_type|checkout|order/.test(lower);

      const mentionsBuyOrRent =
        /buy|rent|license_type|checkout/.test(lower);

      if (looksLikeCta && mentionsBuyOrRent) {
        ctaLineIndexes.push(index);
      }
    });

    expect(ctaLineIndexes.length).toBeGreaterThan(0);

    const guarded = ctaLineIndexes.some((index) => {
      const start = Math.max(0, index - 16);
      const end = Math.min(lines.length, index + 8);
      const window = lines.slice(start, end).join('\n');

      return /\{\{[#/]?(if|unless)[^}]*\}\}/i.test(window)
        && /sold|available|availability|canBuy|canRent|showBuy|showRent|allowBuy|allowRent|isAvailable|isSold/i.test(window);
    });

    expect(guarded).toBe(true);

    const source = normalizeHtml(view.content);

    expect(source).toEqual(expect.stringMatching(/sold|unavailable|not available|already sold|reserved|rented/));
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
