// tests/catalogPreviewPresence.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('catalog preview presence contract', () => {
  test('catalog repository exposes a non-empty preview URL for template cards', () => {
    const src = read('src/server/catalog/templates.repo.js');

    expect(src).toMatch(/preview_image|preview_url|previewUrl/);
    expect(src).toContain('previewUrl');

    const hasPreviewFallback =
      /preview_image/i.test(src) ||
      /preview_url/i.test(src) ||
      /uploads\/previews/i.test(src) ||
      /previewUrl\s*:/i.test(src);

    expect(hasPreviewFallback).toBe(true);
  });

  test('catalog card view renders an image from template.previewUrl', () => {
    const candidates = [
      'src/web/views/pages/templates/index.hbs',
      'src/web/views/pages/templates.hbs',
      'src/web/views/pages/catalog.hbs',
      'src/web/views/partials/template-card.hbs',
      'src/web/views/partials/catalog-card.hbs',
    ];

    const existing = candidates.filter((relPath) => fs.existsSync(path.join(ROOT, relPath)));
    expect(existing.length).toBeGreaterThan(0);

    const joined = existing.map(read).join('\n\n');

    expect(joined).toMatch(/template\.previewUrl|previewUrl/);
    expect(joined).toMatch(/<img[^>]+src=["']\{\{[^}]*previewUrl[^}]*\}\}/i);
  });

  test('real seed data migration assigns previews instead of leaving cards without images', () => {
    const migrationsDir = path.join(ROOT, 'sql', 'migrations');
    const migrations = fs.readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => fs.readFileSync(path.join(migrationsDir, name), 'utf8'))
      .join('\n\n');

    expect(migrations).toMatch(/seller_templates/i);
    expect(migrations).toMatch(/preview_image|preview_url/i);

    const hasSeedPreviewPaths =
      /\/uploads\/previews\//i.test(migrations) ||
      /\/img\/templates\//i.test(migrations) ||
      /\/images\/templates\//i.test(migrations) ||
      /preview_url\s*=\s*'/i.test(migrations) ||
      /preview_image\s*=\s*'/i.test(migrations);

    expect(hasSeedPreviewPaths).toBe(true);
  });

  test('template details page keeps a preview image path available before fallback text', () => {
    const src = read('src/web/views/pages/template-details.hbs');

    expect(src).toContain('template.previewUrl');
    expect(src).toMatch(/<img[^>]+src=["']\{\{template\.previewUrl\}\}/i);
    expect(src).toContain('Preview not available');
  });
});
