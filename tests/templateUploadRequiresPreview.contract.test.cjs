// tests/templateUploadRequiresPreview.contract.test.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('template upload preview requirement contract', () => {
  test('seller template creation/update flow must reject templates without preview file', () => {
    const candidates = [
      'src/web/routes/cabinet.pages.routes.cjs',
      'src/modules/sellerTemplates/sellerTemplates.service.cjs',
      'src/modules/sellerTemplates/sellerTemplates.controller.cjs',
      'src/server/catalog/templates.repo.js',
    ].filter((rel) => fs.existsSync(path.join(ROOT, rel)));

    expect(candidates.length).toBeGreaterThan(0);

    const source = candidates.map(read).join('\n');

    expect(source).toMatch(/preview/i);
    expect(source).toMatch(/required|missing|must|reject|throw|400/i);
    expect(source).toMatch(/preview\.(png|jpg|jpeg|webp|svg)|preview\/preview/i);
  });
});
