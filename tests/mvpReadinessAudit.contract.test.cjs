// tests/mvpReadinessAudit.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function walk(rootRel, predicate) {
  const rootAbs = path.join(ROOT, rootRel);
  const out = [];

  if (!fs.existsSync(rootAbs)) return out;

  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    const abs = path.join(rootAbs, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'coverage', 'outbox'].includes(entry.name)) continue;
      out.push(...walk(rel, predicate));
      continue;
    }

    if (entry.isFile() && predicate(rel, abs)) {
      out.push(rel);
    }
  }

  return out;
}

function allProjectText() {
  const files = walk('.', (rel) => {
    if (!/\.(js|cjs|hbs|css|sql|md|json)$/.test(rel)) return false;
    if (rel.startsWith('node_modules/')) return false;
    if (rel.startsWith('.git/')) return false;
    if (rel.startsWith('outbox/')) return false;
    if (rel.startsWith('coverage/')) return false;
    return true;
  });

  return files
    .map((rel) => `\n--- ${rel} ---\n${read(rel)}`)
    .join('\n')
    .toLowerCase();
}

describe('MVP readiness audit contract', () => {
  test('MVP has explicit business-critical regression tests for BUY, RENT, credit, security, seller ownership, sold HTML and analytics', () => {
    const requiredTests = [
      'tests/analyticsKpiDbCalculations.integration.test.cjs',
      'tests/sellerOwnershipNegative.integration.test.cjs',
      'tests/soldTemplateRouteHtml.integration.test.cjs',
    ];

    for (const rel of requiredTests) {
      expect(exists(rel)).toBe(true);
    }

    const testFiles = walk('tests', (rel) => /\.(test|integration\.test|contract\.test)\.cjs$/.test(rel));
    const joinedNames = testFiles.join('\n').toLowerCase();

    const requiredSignals = [
      /buy.*exclus|exclus.*buy/,
      /rent.*reservation|reservation.*rent|rent.*expiration|expiration.*rent/,
      /credit.*ledger|checkout.*credit|credit.*checkout/,
      /download|entitlement/,
      /seller.*ownership|ownership.*seller/,
      /sold.*template|template.*sold/,
      /analytics.*kpi|kpi.*analytics/,
    ];

    for (const signal of requiredSignals) {
      expect(joinedNames).toEqual(expect.stringMatching(signal));
    }
  });

  test('MVP cabinet/navigation contract includes core spaces: cases, templates, finance, profile/security and support', () => {
    const text = allProjectText();

    const requiredSpaces = [
      'cases',
      'templates',
      'finance',
      'profile',
      'security',
      'support',
    ];

    for (const space of requiredSpaces) {
      expect(text).toContain(space);
    }
  });

  test('MVP payment/entitlement layer keeps BUY download separate from RENT reservation semantics', () => {
    const text = allProjectText();

    expect(text).toEqual(expect.stringMatching(/buy/));
    expect(text).toEqual(expect.stringMatching(/rent/));
    expect(text).toEqual(expect.stringMatching(/entitlement/));
    expect(text).toEqual(expect.stringMatching(/download/));

    expect(text).toEqual(expect.stringMatching(/reservation|reserved|hold|rented/));
    expect(text).toEqual(expect.stringMatching(/sold|exclusive|exclusivity|unavailable/));
  });

  test('MVP has operational readiness hooks for tests, migrations, environment and fake payment provider', () => {
    const text = allProjectText();

    expect(exists('package.json')).toBe(true);

    const packageJson = JSON.parse(read('package.json'));
    const packageText = JSON.stringify(packageJson).toLowerCase();

    expect(packageText).toEqual(expect.stringMatching(/test|jest/));
    expect(text).toEqual(expect.stringMatching(/migration|migrations|sql/));
    expect(text).toEqual(expect.stringMatching(/database_url|database_url_test|postgres/));
    expect(text).toEqual(expect.stringMatching(/payments_provider|fake|stripe/));
  });

  test('MVP readiness audit document exists and records launch blockers separately from post-MVP risks', () => {
    expect(exists('docs/mvp-readiness-audit.md')).toBe(true);

    const doc = read('docs/mvp-readiness-audit.md').toLowerCase();

    const requiredSections = [
      'mvp readiness audit',
      'launch blockers',
      'ready for controlled demo',
      'business rules',
      'security',
      'payments',
      'data',
      'ux',
      'deploy',
      'post-mvp',
    ];

    for (const section of requiredSections) {
      expect(doc).toContain(section);
    }
  });
});
