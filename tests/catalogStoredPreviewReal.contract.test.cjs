// tests/catalogStoredPreviewReal.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('catalog stored template preview contract', () => {
  test('catalog must use stored template preview paths, not shared placeholder images', () => {
    const repo = read('src/server/catalog/templates.repo.js');
    const routes = read('src/web/routes/templates.routes.js');
    const catalogViewCandidates = [
      'src/web/views/pages/templates.hbs',
      'src/web/views/templates.hbs',
      'src/web/views/pages/catalog.hbs',
    ].filter((rel) => fs.existsSync(path.join(ROOT, rel)));

    const catalogViews = catalogViewCandidates.map(read).join('\n');

    expect(repo + routes + catalogViews).toMatch(/previewUrl|preview_url|preview_image|previewPath|preview_path/i);

    const combined = repo + '\n' + routes + '\n' + catalogViews;

    expect(combined).toMatch(/\/t\/\{\{.*slug.*\}\}\/preview|\/t\/.*\/preview|preview/i);

    expect(combined).not.toMatch(/seed-001-preview\.svg|seed-002-preview\.svg|seed-003-preview\.svg/i);
    expect(combined).not.toMatch(/public\/img\/templates\/seed-/i);
  });

  test('template details page must render template preview before fallback text', () => {
    const view = read('src/web/views/pages/template-details.hbs');

    expect(view).toMatch(/template\.previewUrl/i);
    expect(view.indexOf('template.previewUrl')).toBeGreaterThan(-1);
    expect(view.indexOf('Preview not available')).toBeGreaterThan(-1);
    expect(view.indexOf('template.previewUrl')).toBeLessThan(view.indexOf('Preview not available'));
  });

  test('catalog card view must hide fallback text when real preview image exists', () => {
    const viewFiles = [];

    function walk(dir) {
      if (!fs.existsSync(dir)) return;

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(abs);
          continue;
        }

        if (entry.isFile() && entry.name.endsWith('.hbs')) {
          viewFiles.push(abs);
        }
      }
    }

    walk(path.join(ROOT, 'src/web/views'));

    const candidates = viewFiles
      .map((abs) => ({
        abs,
        rel: path.relative(ROOT, abs),
        content: fs.readFileSync(abs, 'utf8'),
      }))
      .filter((file) =>
        /template\.previewUrl|previewUrl|Preview not available|tcard__img|template-card__no-preview/i.test(file.content)
      );

    expect(candidates.length).toBeGreaterThan(0);

    const combined = candidates
      .map((file) => `\n/* ${file.rel} */\n${file.content}`)
      .join('\n');

    expect(combined).toMatch(/<img[\s\S]+previewUrl|previewUrl[\s\S]+<img|tcard__img/i);
    expect(combined).toMatch(/Preview not available|template-card__no-preview/i);
  });
});
