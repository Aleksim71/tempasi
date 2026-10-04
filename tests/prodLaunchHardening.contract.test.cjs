// tests/prodLaunchHardening.contract.test.cjs
'use strict';

// TEMPASI_PAYMENTS_UNAVAILABLE_GUARD + TEMPASI_EXTRACT_PERMISSIONS_NORMALIZE (2026-10-04)
// VPS launch hardening: no checkout while production runs on the fake
// payments provider; extracted template files get predictable modes so
// the static file server (group-read) can always serve them.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_KEYS = ['NODE_ENV', 'PAYMENTS_PROVIDER'];

describe('payments unavailable guard', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    jest.resetModules();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('production + fake provider (default): payments unavailable', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENTS_PROVIDER;
    const svc = require('../src/modules/orders/orders.service.cjs');
    expect(svc.paymentsAvailable()).toBe(false);
    process.env.PAYMENTS_PROVIDER = 'FAKE';
    expect(svc.paymentsAvailable()).toBe(false);
  });

  test('non-production, or a real provider: payments available', () => {
    const svc = require('../src/modules/orders/orders.service.cjs');
    process.env.NODE_ENV = 'development';
    delete process.env.PAYMENTS_PROVIDER;
    expect(svc.paymentsAvailable()).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(svc.paymentsAvailable()).toBe(true);
    process.env.NODE_ENV = 'production';
    process.env.PAYMENTS_PROVIDER = 'stripe';
    expect(svc.paymentsAvailable()).toBe(true);
  });

  test('createOrderCheckout fails fast with PAYMENTS_UNAVAILABLE before touching orders', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENTS_PROVIDER;
    const repo = require('../src/modules/orders/orders.repo.cjs');
    const spies = Object.keys(repo)
      .filter((k) => typeof repo[k] === 'function')
      .map((k) => jest.spyOn(repo, k).mockImplementation(() => {
        throw new Error(`orders.repo.${k} must not be called`);
      }));
    const svc = require('../src/modules/orders/orders.service.cjs');

    await expect(
      svc.createOrderCheckout({}, { userId: 1, templateSlug: 'seed-001', payload: { dealType: 'BUY' } }),
    ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE', status: 503 });

    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  test('catalog shows a readable message for PAYMENTS_UNAVAILABLE', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/web/routes/templates.routes.js'), 'utf8');
    expect(src).toMatch(/PAYMENTS_UNAVAILABLE:\s*\n?\s*'[^']+'/);
  });
});

describe('extracted template permissions', () => {
  test('normalizeTreePermissions: dirs 2750, files 640, regardless of modes from the zip', () => {
    const { normalizeTreePermissions } = require('../src/modules/templates/templateZip.contract.cjs');
    expect(typeof normalizeTreePermissions).toBe('function');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tempasi-perm-'));
    try {
      const slug = path.join(root, 'slug');
      fs.mkdirSync(path.join(slug, 'src', 'assets'), { recursive: true });
      fs.writeFileSync(path.join(slug, 'src', 'index.html'), '<h1>x</h1>');
      fs.writeFileSync(path.join(slug, 'src', 'assets', 'a.css'), 'a{}');
      fs.chmodSync(path.join(slug, 'src', 'index.html'), 0o600);
      fs.chmodSync(path.join(slug, 'src', 'assets', 'a.css'), 0o777);
      fs.chmodSync(path.join(slug, 'src', 'assets'), 0o700);
      fs.chmodSync(path.join(slug, 'src'), 0o777);

      normalizeTreePermissions(slug);

      const mode = (p) => fs.statSync(p).mode & 0o7777;
      expect(mode(slug)).toBe(0o2750);
      expect(mode(path.join(slug, 'src'))).toBe(0o2750);
      expect(mode(path.join(slug, 'src', 'assets'))).toBe(0o2750);
      expect(mode(path.join(slug, 'src', 'index.html'))).toBe(0o640);
      expect(mode(path.join(slug, 'src', 'assets', 'a.css'))).toBe(0o640);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('extractFullTemplateToUploadDir calls the normalizer after copying', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/modules/templates/templateZip.contract.cjs'), 'utf8');
    const copyAt = src.indexOf('fs.cpSync(path.join(payloadRoot, entry.name)');
    const normAt = src.indexOf('normalizeTreePermissions(targetDir)');
    expect(copyAt).toBeGreaterThan(-1);
    expect(normAt).toBeGreaterThan(copyAt);
  });
});
